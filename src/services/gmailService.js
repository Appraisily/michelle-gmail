import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
let auth = null;

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
      await gmail.users.getProfile({ userId: 'me' });
      logger.info('Gmail credentials verified successfully');
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
    logger.info('Fetching message history', { startHistoryId });
    
    const response = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded']
    });

    if (!response.data.history) {
      logger.info('No new messages in history', { startHistoryId });
      return 0;
    }

    logger.info('Found messages in history', { 
      historyCount: response.data.history.length,
      startHistoryId 
    });

    let processedCount = 0;
    for (const history of response.data.history) {
      for (const message of history.messagesAdded || []) {
        try {
          logger.info('Processing message', { 
            messageId: message.message.id,
            threadId: message.message.threadId 
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.message.id,
            format: 'full'
          });

          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: messageData.data.payload.headers.find(h => h.name.toLowerCase() === 'subject')?.value,
            from: messageData.data.payload.headers.find(h => h.name.toLowerCase() === 'from')?.value,
            body: messageData.data.snippet
          };

          logger.info('Email content retrieved', {
            subject: emailContent.subject,
            from: emailContent.from,
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
            messageId: message.message.id,
            error: error.message,
            stack: error.stack
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

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
    const processedCount = await processNewMessages(data.historyId);
    
    const processingTime = Date.now() - startTime;
    logger.info('Webhook processing completed', {
      processed: processedCount > 0,
      messages: processedCount,
      processingTime
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

    logger.info('Gmail watch renewed successfully', {
      historyId: response.data.historyId,
      expiration: new Date(parseInt(response.data.expiration)).toISOString()
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