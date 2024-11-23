import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
let auth = null;
let lastHistoryId = null;

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

    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      
      await gmail.users.labels.list({ userId: 'me' });
      
      lastHistoryId = profile.data.historyId;
      logger.info('Gmail credentials and permissions verified successfully', { 
        historyId: lastHistoryId,
        email: profile.data.emailAddress 
      });
    } catch (error) {
      logger.error('Gmail authentication failed:', {
        error: error.message,
        response: error.response?.data,
        code: error.code,
        status: error.response?.status
      });
      throw new Error(`Gmail authentication failed: ${error.message}`);
    }

    auth = oauth2Client;
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

    if (!startHistoryId || isNaN(parseInt(startHistoryId))) {
      logger.error('Invalid historyId received', { startHistoryId });
      return 0;
    }

    let historyResponse;
    try {
      historyResponse = await gmail.users.history.list({
        auth,
        userId: 'me',
        startHistoryId: startHistoryId,
        historyTypes: ['messageAdded']
      });

      // Log the raw history response for debugging
      logger.info('Raw history response', {
        history: historyResponse.data.history?.map(h => ({
          id: h.id,
          messages: h.messagesAdded?.map(m => ({
            threadId: m.message.threadId,
            messageId: m.message.id
          }))
        }))
      });

    } catch (error) {
      if (error.response?.status === 404) {
        logger.error('History ID not found or too old', { 
          startHistoryId,
          error: error.message 
        });
        const profile = await gmail.users.getProfile({ 
          auth,
          userId: 'me' 
        });
        lastHistoryId = profile.data.historyId;
        return 0;
      }
      throw error;
    }

    if (!historyResponse.data.history) {
      logger.info('No new messages to process');
      return 0;
    }

    let processedCount = 0;
    for (const history of historyResponse.data.history) {
      for (const message of history.messagesAdded || []) {
        try {
          // Log raw message data for debugging
          logger.info('Raw message data', {
            threadId: message.message.threadId,
            messageId: message.message.id,
            labelIds: message.message.labelIds
          });

          // Get full thread details
          const threadResponse = await gmail.users.threads.get({
            auth,
            userId: 'me',
            id: message.message.threadId
          });

          logger.info('Thread details', {
            threadId: threadResponse.data.id,
            messageCount: threadResponse.data.messages?.length,
            snippet: threadResponse.data.snippet,
            historyId: threadResponse.data.historyId
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.message.id,
            format: 'full'
          });

          const headers = messageData.data.payload.headers;
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Email content', {
            threadId: emailContent.threadId,
            messageId: emailContent.id,
            subject: emailContent.subject,
            from: emailContent.from,
            labelIds: messageData.data.labelIds,
            internalDate: messageData.data.internalDate
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
          
          if (requiresReply) {
            logger.info('Generating reply', { 
              threadId: emailContent.threadId,
              messageId: emailContent.id,
              subject: emailContent.subject
            });

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

            const sentResponse = await gmail.users.messages.send({
              auth,
              userId: 'me',
              resource: replyMessage
            });

            logger.info('Reply sent', { 
              originalThreadId: emailContent.threadId,
              originalMessageId: emailContent.id,
              replyMessageId: sentResponse.data.id,
              replyThreadId: sentResponse.data.threadId
            });
            
            recordMetric('replies_sent', 1);
          }

          await logEmailProcessing({
            timestamp: new Date().toISOString(),
            sender: emailContent.from,
            subject: emailContent.subject,
            content: emailContent.body,
            requiresReply,
            reply: generatedReply || 'No reply needed',
            messageId: emailContent.id,
            threadId: emailContent.threadId
          });

          processedCount++;
          recordMetric('emails_processed', 1);
        } catch (error) {
          logger.error('Message processing error:', {
            threadId: message.message.threadId,
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
    logger.error('History fetch error:', {
      error: error.message,
      stack: error.stack
    });
    recordMetric('email_fetch_failures', 1);
    throw error;
  }
}

export async function handleWebhook(data) {
  logger.info('Gmail webhook received:', {
    historyId: data.historyId,
    emailAddress: data.emailAddress
  });
  
  const startTime = Date.now();

  try {
    const processedCount = await processNewMessages(data.historyId);
    
    const processingTime = Date.now() - startTime;
    logger.info('Webhook processing completed', {
      processed: processedCount > 0,
      messages: processedCount,
      processingTime,
      historyId: data.historyId
    });
  } catch (error) {
    logger.error('Webhook handler error:', {
      error: error.message,
      stack: error.stack,
      historyId: data.historyId
    });
    throw error;
  }
}

export async function initializeGmailWatch() {
  try {
    logger.info('Starting Gmail watch initialization...');
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    logger.info(`Using Pub/Sub topic: ${topicName}`);

    await stopExistingWatch();

    const response = await gmail.users.watch({
      auth: await getGmailAuth(),
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });

    const expirationDate = new Date(parseInt(response.data.expiration));
    logger.info('Gmail watch setup successful', {
      historyId: response.data.historyId,
      expiration: expirationDate.toISOString(),
      topicName
    });

    recordMetric('gmail_watch_renewals', 1);
    return response.data;
  } catch (error) {
    logger.error('Gmail watch initialization error:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

async function stopExistingWatch() {
  try {
    const auth = await getGmailAuth();
    await gmail.users.stop({
      userId: 'me',
      auth
    });
    logger.info('Stopped existing Gmail watch');
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
    } else {
      logger.warn('Gmail watch stop error:', {
        error: error.message,
        code: error.code
      });
    }
  }
}