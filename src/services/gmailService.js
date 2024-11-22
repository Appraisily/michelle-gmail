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

async function verifyPubSubTopic() {
  const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
  try {
    // Try to send a test message to verify permissions
    const auth = await getGmailAuth();
    await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    logger.info('Pub/Sub topic verification successful');
    return true;
  } catch (error) {
    logger.error('Pub/Sub topic verification failed:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    return false;
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
    // Wait a moment to ensure the stop takes effect
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    // If no watch exists, that's fine
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
    } else {
      logger.warn('Error stopping existing Gmail watch:', error);
    }
  }
}

async function setupNewWatch() {
  const auth = await getGmailAuth();
  const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;

  const response = await gmail.users.watch({
    auth,
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

  return response.data;
}

async function verifyWatchSetup() {
  try {
    const auth = await getGmailAuth();
    const response = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    if (response.data.historyId) {
      logger.info('Watch setup verified successfully', {
        historyId: response.data.historyId
      });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Watch setup verification failed:', error);
    return false;
  }
}

async function processNewMessages(startHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    const response = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded']
    });

    if (!response.data.history) {
      logger.info('No new messages to process');
      return 0;
    }

    let processedCount = 0;
    for (const history of response.data.history) {
      for (const message of history.messagesAdded || []) {
        try {
          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.message.id,
            format: 'full'
          });

          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: messageData.data.payload.headers.find(h => h.name === 'Subject')?.value,
            from: messageData.data.payload.headers.find(h => h.name === 'From')?.value,
            body: messageData.data.snippet
          };

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
          
          if (requiresReply) {
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

            logger.info('Reply sent successfully', { messageId: emailContent.id });
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
            error: error.message
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

    return processedCount;
  } catch (error) {
    logger.error('Error fetching message history:', error);
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
      processed: true,
      messages: processedCount,
      processingTime
    });
  } catch (error) {
    logger.error('Error in webhook handler:', error);
    throw error;
  }
}

export async function renewGmailWatch() {
  try {
    logger.info('Starting Gmail watch renewal process...');
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    logger.info(`Using Pub/Sub topic: ${topicName}`);

    // Step 1: Verify Pub/Sub permissions
    const pubsubVerified = await verifyPubSubTopic();
    if (!pubsubVerified) {
      throw new Error('Failed to verify Pub/Sub topic permissions');
    }

    // Step 2: Stop existing watch
    await stopExistingWatch();

    // Step 3: Set up new watch
    const watchData = await setupNewWatch();
    
    // Step 4: Verify watch setup
    const watchVerified = await verifyWatchSetup();
    if (!watchVerified) {
      throw new Error('Failed to verify watch setup');
    }

    recordMetric('gmail_watch_renewals', 1);
    return watchData;
  } catch (error) {
    logger.error('Error in Gmail watch renewal:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}