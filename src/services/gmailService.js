import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { getSecrets } from '../utils/secretManager.js';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;
let watchExpiration = null;

async function getGmailAuth() {
  const secrets = await getSecrets();
  const oauth2Client = new google.auth.OAuth2(
    secrets.GMAIL_CLIENT_ID,
    secrets.GMAIL_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: secrets.GMAIL_REFRESH_TOKEN
  });

  return oauth2Client;
}

async function stopExistingWatch(auth) {
  try {
    await gmail.users.stop({
      auth,
      userId: 'me'
    });
    logger.info('Stopped existing Gmail watch');
    watchExpiration = null;
  } catch (error) {
    if (!error.message.includes('No watch exists')) {
      logger.warn('Error stopping existing watch:', { error: error.message });
    }
  }
}

async function initializeHistoryId(auth) {
  try {
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });

    lastHistoryId = profile.data.historyId;
    logger.info('Initialized history ID from profile', {
      historyId: lastHistoryId,
      email: process.env.GMAIL_USER_EMAIL
    });
    return lastHistoryId;
  } catch (error) {
    logger.error('Failed to initialize history ID:', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

export async function initializeGmailWatch() {
  try {
    logger.info('Starting Gmail watch initialization...', {
      email: process.env.GMAIL_USER_EMAIL,
      topic: process.env.PUBSUB_TOPIC
    });
    
    const auth = await getGmailAuth();
    logger.info('Gmail credentials and permissions verified successfully');

    if (!lastHistoryId) {
      await initializeHistoryId(auth);
    }

    await stopExistingWatch(auth);

    const watchResponse = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });

    watchExpiration = watchResponse.data.expiration;
    
    logger.info('Gmail watch setup successful', {
      historyId: watchResponse.data.historyId,
      expiration: new Date(parseInt(watchExpiration)).toISOString(),
      currentHistoryId: lastHistoryId,
      watchData: JSON.stringify(watchResponse.data)
    });

    if (!lastHistoryId || parseInt(watchResponse.data.historyId) > parseInt(lastHistoryId)) {
      lastHistoryId = watchResponse.data.historyId;
      logger.info('Updated lastHistoryId from watch response', {
        historyId: lastHistoryId
      });
    }

    recordMetric('gmail_watch_renewals', 1);
    return watchResponse.data;
  } catch (error) {
    logger.error('Failed to initialize Gmail watch:', { 
      error: error.message,
      stack: error.stack 
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

export async function handleWebhook(rawData) {
  try {
    logger.info('Raw webhook data received:', {
      rawData: JSON.stringify(rawData)
    });

    let data;
    if (rawData.message && rawData.message.data) {
      const decodedData = Buffer.from(rawData.message.data, 'base64').toString();
      data = JSON.parse(decodedData);
      logger.info('Decoded Pub/Sub message:', {
        decodedData: JSON.stringify(data)
      });
    } else {
      data = rawData;
      logger.info('Using raw data as no base64 encoding found');
    }

    logger.info('📨 Gmail Webhook Data Received', {
      historyId: data.historyId,
      emailAddress: data.emailAddress,
      timestamp: new Date().toISOString(),
      decodedData: JSON.stringify(data),
      currentHistoryId: lastHistoryId
    });

    if (watchExpiration && Date.now() > parseInt(watchExpiration) - 24 * 60 * 60 * 1000) {
      logger.info('Watch expiring soon, initiating renewal', {
        currentExpiration: new Date(parseInt(watchExpiration)).toISOString(),
        timeUntilExpiration: parseInt(watchExpiration) - Date.now()
      });
      await initializeGmailWatch();
    }

    const processedCount = await processNewMessages(data.historyId);
    
    logger.info('Webhook processing completed', {
      processedCount,
      historyId: data.historyId,
      currentHistoryId: lastHistoryId
    });

    return processedCount;
  } catch (error) {
    logger.error('Webhook processing failed:', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

async function processNewMessages(notificationHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    logger.info('Starting message processing', { 
      lastHistoryId: lastHistoryId || 'not_set',
      notificationHistoryId,
      hasLastHistoryId: !!lastHistoryId,
      email: process.env.GMAIL_USER_EMAIL
    });

    if (!notificationHistoryId || isNaN(parseInt(notificationHistoryId))) {
      logger.error('Invalid notification historyId', { 
        receivedHistoryId: notificationHistoryId 
      });
      return 0;
    }

    if (!lastHistoryId) {
      await initializeHistoryId(auth);
      return 0;
    }

    let historyResponse;
    try {
      logger.info('Fetching history', {
        startHistoryId: lastHistoryId,
        notificationHistoryId
      });

      historyResponse = await gmail.users.history.list({
        auth,
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        maxResults: 100
      });

      logger.info('History response details', {
        hasHistory: !!historyResponse.data.history,
        historyCount: historyResponse.data.history?.length || 0,
        nextPageToken: !!historyResponse.data.nextPageToken,
        startHistoryId: lastHistoryId,
        endHistoryId: notificationHistoryId,
        historyData: JSON.stringify(historyResponse.data)
      });

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('History ID not found - resetting', { 
          lastHistoryId,
          notificationHistoryId,
          error: error.message 
        });
        await initializeHistoryId(auth);
        return 0;
      }
      throw error;
    }

    if (!historyResponse.data.history) {
      logger.info('No history entries found', {
        lastHistoryId,
        notificationHistoryId,
        responseData: JSON.stringify(historyResponse.data)
      });
      return 0;
    }

    let processedCount = 0;
    for (const history of historyResponse.data.history) {
      logger.info('Processing history entry', {
        historyId: history.id,
        lastHistoryId,
        notificationHistoryId,
        messageCount: history.messagesAdded?.length || 0,
        historyData: JSON.stringify(history)
      });

      if (!history.messagesAdded) {
        logger.info('No messages in history entry', {
          historyId: history.id,
          historyType: Object.keys(history).join(', '),
          fullHistory: JSON.stringify(history)
        });
        continue;
      }

      for (const messageAdded of history.messagesAdded) {
        try {
          if (!messageAdded.message) {
            logger.warn('Empty message in messagesAdded', {
              historyId: history.id,
              messageAddedData: JSON.stringify(messageAdded)
            });
            continue;
          }

          logger.info('Processing new message', { 
            messageId: messageAdded.message.id,
            threadId: messageAdded.message.threadId,
            historyId: history.id,
            labelIds: messageAdded.message.labelIds,
            messageData: JSON.stringify(messageAdded.message)
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: messageAdded.message.id,
            format: 'full'
          });

          logger.info('Retrieved full message data', {
            messageId: messageData.data.id,
            threadId: messageData.data.threadId,
            historyId: history.id,
            snippet: messageData.data.snippet,
            hasPayload: !!messageData.data.payload,
            messageDetails: JSON.stringify(messageData.data)
          });

          const headers = messageData.data.payload?.headers || [];
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Parsed email content', {
            messageId: emailContent.id,
            threadId: emailContent.threadId,
            subject: emailContent.subject,
            from: emailContent.from,
            body: emailContent.body,
            bodyLength: emailContent.body.length,
            headers: JSON.stringify(headers)
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);

          logger.info('Email classification result', {
            messageId: emailContent.id,
            requiresReply,
            hasReply: !!generatedReply
          });

          await logEmailProcessing({
            timestamp: new Date().toISOString(),
            sender: emailContent.from,
            subject: emailContent.subject,
            requiresReply,
            reply: generatedReply || 'No reply needed'
          });

          if (requiresReply && generatedReply) {
            logger.info('Sending reply', {
              messageId: emailContent.id,
              threadId: emailContent.threadId,
              to: emailContent.from,
              subject: emailContent.subject
            });

            await gmail.users.messages.send({
              auth,
              userId: 'me',
              requestBody: {
                threadId: emailContent.threadId,
                raw: Buffer.from(
                  `To: ${emailContent.from}\r\n` +
                  `Subject: Re: ${emailContent.subject}\r\n` +
                  `Content-Type: text/plain; charset="UTF-8"\r\n` +
                  `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                  `${generatedReply}`
                ).toString('base64')
              }
            });

            logger.info('Reply sent successfully', {
              messageId: emailContent.id,
              threadId: emailContent.threadId
            });

            recordMetric('replies_sent', 1);
          }
          
          processedCount++;
          recordMetric('emails_processed', 1);
        } catch (error) {
          logger.error('Message processing failed', {
            messageId: messageAdded.message?.id,
            threadId: messageAdded.message?.threadId,
            historyId: history.id,
            error: error.message,
            stack: error.stack
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

    if (processedCount > 0) {
      const oldHistoryId = lastHistoryId;
      lastHistoryId = notificationHistoryId;
      logger.info('Updated lastHistoryId', {
        oldHistoryId,
        newHistoryId: lastHistoryId,
        processedCount
      });
    }

    return processedCount;
  } catch (error) {
    logger.error('History processing failed', {
      lastHistoryId,
      notificationHistoryId,
      error: error.message,
      stack: error.stack
    });
    recordMetric('email_fetch_failures', 1);
    throw error;
  }
}