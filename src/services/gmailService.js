import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
let auth = null;
let lastHistoryId = null;

// Track processed history IDs to prevent duplicates
const processedHistoryIds = new Set();
const HISTORY_RETENTION_TIME = 60 * 60 * 1000; // 1 hour

// Cleanup old history IDs periodically
setInterval(() => {
  processedHistoryIds.clear();
  logger.info('Cleared processed history IDs cache');
}, HISTORY_RETENTION_TIME);

async function getGmailAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    // Verify the credentials work
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      lastHistoryId = profile.data.historyId;
      logger.info('Gmail credentials verified successfully', { historyId: lastHistoryId });
    } catch (error) {
      logger.error('Gmail credentials verification failed:', error);
      throw new Error('Gmail authentication failed');
    }

    auth = oauth2Client;
    logger.info('Gmail authentication initialized successfully');
  }
  return auth;
}

async function processNewMessages(startHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    logger.info('Fetching message history', { 
      startHistoryId,
      lastKnownHistoryId: lastHistoryId 
    });
    
    // If no startHistoryId provided, use the last known one
    const historyId = startHistoryId || lastHistoryId;
    if (!historyId) {
      logger.warn('No history ID available');
      return 0;
    }

    // Check if we've already processed this history ID
    if (processedHistoryIds.has(historyId)) {
      logger.info('History ID already processed, skipping', { historyId });
      return 0;
    }

    const response = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded', 'labelsAdded'],
      labelId: 'INBOX'
    });

    if (!response.data.history) {
      logger.info('No new messages in history', { historyId });
      processedHistoryIds.add(historyId);
      return 0;
    }

    logger.info('Found messages in history', { 
      historyCount: response.data.history.length,
      historyId 
    });

    let processedCount = 0;
    for (const history of response.data.history) {
      // Update last known history ID
      lastHistoryId = history.id;
      
      const messages = [
        ...(history.messagesAdded || []),
        ...(history.labelsAdded || []).filter(label => 
          label.labelIds?.includes('INBOX')
        )
      ];

      for (const messageInfo of messages) {
        const message = messageInfo.message || messageInfo;
        try {
          logger.info('Processing message', { 
            messageId: message.id,
            threadId: message.threadId 
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.id,
            format: 'full'
          });

          // Extract email body from payload
          let body = messageData.data.snippet;
          if (messageData.data.payload) {
            const parts = messageData.data.payload.parts || [messageData.data.payload];
            for (const part of parts) {
              if (part.mimeType === 'text/plain' && part.body?.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf8');
                break;
              }
            }
          }

          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: messageData.data.payload.headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(No subject)',
            from: messageData.data.payload.headers.find(h => h.name.toLowerCase() === 'from')?.value || 'unknown',
            body: body || '(No content)'
          };

          logger.info('Email content retrieved', {
            subject: emailContent.subject,
            from: emailContent.from,
            bodyLength: emailContent.body.length,
            snippet: emailContent.body.substring(0, 100) + '...'
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
          
          if (requiresReply) {
            logger.info('Generating reply for email', {
              messageId: emailContent.id,
              subject: emailContent.subject
            });

            // Send reply
            const replyMessage = {
              userId: 'me',
              resource: {
                raw: Buffer.from(
                  `To: ${emailContent.from}\r\n` +
                  `Subject: Re: ${emailContent.subject}\r\n` +
                  `In-Reply-To: ${emailContent.id}\r\n` +
                  `References: ${emailContent.id}\r\n` +
                  `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
                  `${generatedReply}`
                ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
              },
              threadId: emailContent.threadId
            };

            await gmail.users.messages.send({
              auth,
              userId: 'me',
              resource: replyMessage
            });

            logger.info('Reply sent successfully', { 
              messageId: emailContent.id,
              subject: emailContent.subject 
            });
          }

          await logEmailProcessing({
            timestamp: new Date().toISOString(),
            sender: emailContent.from,
            subject: emailContent.subject,
            content: emailContent.body,
            requiresReply,
            reply: generatedReply || 'No reply needed'
          });

          processedCount++;
          recordMetric('emails_processed', 1);
        } catch (error) {
          logger.error('Error processing message:', {
            messageId: message.id,
            error: error.message,
            stack: error.stack
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

    // Mark this history ID as processed
    processedHistoryIds.add(historyId);
    return processedCount;
  } catch (error) {
    logger.error('Error fetching message history:', {
      error: error.message,
      stack: error.stack,
      startHistoryId
    });
    throw error;
  }
}

export async function handleWebhook(data) {
  logger.info('Processing Gmail webhook:', data);
  const startTime = Date.now();

  try {
    // If we don't get a historyId in the notification, use the last known one
    const historyId = data?.historyId || lastHistoryId;
    if (!historyId) {
      logger.warn('No history ID available in webhook or last known');
      return;
    }

    const processedCount = await processNewMessages(historyId);
    
    const processingTime = Date.now() - startTime;
    logger.info('Webhook processing completed', {
      processed: processedCount > 0,
      messages: processedCount,
      processingTime,
      historyId
    });
  } catch (error) {
    logger.error('Error in webhook handler:', {
      error: error.message,
      stack: error.stack,
      data
    });
    throw error;
  }
}

export async function renewGmailWatch() {
  try {
    logger.info('Starting Gmail watch renewal process...');
    const auth = await getGmailAuth();
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    
    // Stop existing watch
    try {
      await gmail.users.stop({
        userId: 'me',
        auth
      });
      logger.info('Stopped existing Gmail watch');
      // Wait a moment to ensure the stop takes effect
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      // If no watch exists, that's fine
      if (error.code !== 404) {
        logger.warn('Error stopping existing Gmail watch:', error);
      }
    }

    // Set up new watch
    const response = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });

    // Store the initial historyId
    lastHistoryId = response.data.historyId;

    logger.info('Gmail watch renewed successfully', {
      historyId: response.data.historyId,
      expiration: new Date(parseInt(response.data.expiration)).toISOString(),
      topicName
    });

    recordMetric('gmail_watch_renewals', 1);
    return response.data;
  } catch (error) {
    logger.error('Error in Gmail watch renewal:', {
      error: error.message,
      stack: error.stack
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}