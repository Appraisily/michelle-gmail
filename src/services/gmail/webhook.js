import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';
import { processMessage } from './sender.js';

const gmail = google.gmail('v1');

async function getLatestMessage(auth, historyId) {
  try {
    // Get messages list
    const response = await gmail.users.messages.list({
      auth,
      userId: 'me',
      maxResults: 1,
      q: `after:${Math.floor(Date.now() / 1000 - 300)}` // Last 5 minutes
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      logger.warn('No recent messages found');
      return null;
    }

    const message = response.data.messages[0];
    logger.info('Found latest message', {
      messageId: message.id,
      threadId: message.threadId,
      timestamp: new Date().toISOString()
    });

    return message;
  } catch (error) {
    logger.error('Error getting latest message:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return null;
  }
}

export async function handleWebhook(data) {
  try {
    const auth = await getGmailAuth();
    
    // Validate and decode Pub/Sub message
    if (!data.message?.data) {
      throw new Error('Invalid Pub/Sub message format');
    }

    const decodedData = JSON.parse(Buffer.from(data.message.data, 'base64').toString());
    
    if (!decodedData.historyId) {
      throw new Error('No historyId in notification');
    }

    logger.info('Processing webhook notification', {
      emailAddress: decodedData.emailAddress,
      historyId: decodedData.historyId,
      timestamp: new Date().toISOString()
    });

    // Get the latest message that triggered this notification
    const latestMessage = await getLatestMessage(auth, decodedData.historyId);
    if (!latestMessage) {
      logger.warn('No message found to process', {
        historyId: decodedData.historyId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Process the single message
    logger.info('Processing single message', {
      messageId: latestMessage.id,
      threadId: latestMessage.threadId,
      timestamp: new Date().toISOString()
    });

    const success = await processMessage(auth, latestMessage.id);
    
    if (success) {
      logger.info('Message processed successfully', {
        messageId: latestMessage.id,
        threadId: latestMessage.threadId,
        historyId: decodedData.historyId,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.error('Failed to process message', {
        messageId: latestMessage.id,
        threadId: latestMessage.threadId,
        historyId: decodedData.historyId,
        timestamp: new Date().toISOString()
      });
    }

    // Always acknowledge the message
    logger.info('Pub/Sub message acknowledged', {
      messageId: data.message.messageId,
      subscription: data.subscription,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Webhook processing failed:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}