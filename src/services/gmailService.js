import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { getSecrets } from '../utils/secretManager.js';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { initializeGmailAuth } from './gmailAuth.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;

export async function processNewMessages(notificationHistoryId) {
  const auth = await initializeGmailAuth();
  
  try {
    logger.info('Starting message processing', { 
      lastHistoryId: lastHistoryId || 'not_set',
      notificationHistoryId,
      hasLastHistoryId: !!lastHistoryId,
      email: 'info@appraisily.com'
    });

    if (!notificationHistoryId || isNaN(parseInt(notificationHistoryId))) {
      logger.error('Invalid notification historyId', { 
        receivedHistoryId: notificationHistoryId 
      });
      return 0;
    }

    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      lastHistoryId = profile.data.historyId;
      logger.info('Initialized history ID', {
        historyId: lastHistoryId,
        email: 'info@appraisily.com'
      });
    }

    let historyResponse;
    try {
      logger.info('Fetching history', {
        startHistoryId: lastHistoryId,
        endHistoryId: notificationHistoryId
      });

      historyResponse = await gmail.users.history.list({
        auth,
        userId: 'me',
        startHistoryId: lastHistoryId,
        maxResults: 100
      });

      logger.info('History response received', {
        hasHistory: !!historyResponse.data.history,
        historyCount: historyResponse.data.history?.length || 0,
        nextPageToken: !!historyResponse.data.nextPageToken,
        historyData: JSON.stringify(historyResponse.data)
      });

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('History ID not found - resetting', { 
          lastHistoryId,
          notificationHistoryId,
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
      logger.info('No history entries found', {
        lastHistoryId,
        notificationHistoryId
      });
      return 0;
    }

    let processedCount = 0;
    for (const history of historyResponse.data.history) {
      logger.info('Processing history entry', {
        historyId: history.id,
        messageCount: history.messagesAdded?.length || 0,
        historyData: JSON.stringify(history)
      });

      if (!history.messagesAdded) {
        logger.info('No messages in history entry', {
          historyId: history.id,
          historyType: Object.keys(history).join(', ')
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
            labelIds: messageAdded.message.labelIds
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: messageAdded.message.id,
            format: 'full'
          });

          const headers = messageData.data.payload?.headers || [];
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Message content parsed', {
            messageId: emailContent.id,
            threadId: emailContent.threadId,
            subject: emailContent.subject,
            from: emailContent.from,
            bodyLength: emailContent.body.length,
            headers: JSON.stringify(headers)
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);

          logger.info('Email classification completed', {
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
            logger.info('Sending automated reply', {
              messageId: emailContent.id,
              threadId: emailContent.threadId,
              to: emailContent.from,
              subject: `Re: ${emailContent.subject}`
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
      lastHistoryId = notificationHistoryId;
      logger.info('Updated lastHistoryId', {
        oldHistoryId: lastHistoryId,
        newHistoryId: notificationHistoryId,
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

export async function handleWebhook(rawData) {
  try {
    logger.info('Webhook data received', {
      rawData: JSON.stringify(rawData)
    });

    let data;
    if (rawData.message && rawData.message.data) {
      const decodedData = Buffer.from(rawData.message.data, 'base64').toString();
      data = JSON.parse(decodedData);
      logger.info('Decoded webhook data', {
        decodedData: JSON.stringify(data)
      });
    } else {
      data = rawData;
      logger.info('Using raw webhook data (no base64 encoding)');
    }

    if (!data.historyId) {
      logger.error('No historyId in webhook data', {
        data: JSON.stringify(data)
      });
      return 0;
    }

    logger.info('Processing webhook data', {
      historyId: data.historyId,
      emailAddress: data.emailAddress || 'info@appraisily.com',
      timestamp: new Date().toISOString(),
      currentHistoryId: lastHistoryId
    });

    const processedCount = await processNewMessages(data.historyId);
    
    logger.info('Webhook processing completed', {
      processedCount,
      historyId: data.historyId,
      currentHistoryId: lastHistoryId
    });

    return processedCount;
  } catch (error) {
    logger.error('Webhook processing failed', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}