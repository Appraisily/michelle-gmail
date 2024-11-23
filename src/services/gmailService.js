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

          const headers = messageData.data.payload.headers;
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Retrieved email content', {
            subject: emailContent.subject,
            from: emailContent.from,
            bodyLength: emailContent.body.length
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
          
          if (requiresReply) {
            logger.info('Generating reply for email', { 
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

            await gmail.users.messages.send({
              auth,
              userId: 'me',
              resource: replyMessage
            });

            logger.info('Reply sent successfully', { messageId: emailContent.id });
            recordMetric('replies_sent', 1);
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
      stack: error.stack
    });
    recordMetric('email_fetch_failures', 1);
    throw error;
  }
}

export async function handleWebhook(data) {
  logger.info('Processing Gmail webhook:', {
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
      processingTime
    });
  } catch (error) {
    logger.error('Error in webhook handler:', {
      error: error.message,
      stack: error.stack
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
    logger.error('Error in Gmail watch initialization:', {
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
      logger.warn('Error stopping existing Gmail watch:', {
        error: error.message,
        code: error.code
      });
    }
  }
}