import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';
import { processMessage } from './message.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;
const processedHistoryIds = new Set();
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

async function initializeHistoryId(auth) {
  try {
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    lastHistoryId = profile.data.historyId;
    logger.info('Initialized history ID', { 
      historyId: lastHistoryId,
      email: profile.data.emailAddress 
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

async function fetchHistory(auth, startHistoryId, pageToken = null) {
  try {
    const params = {
      auth,
      userId: 'me',
      startHistoryId,
      maxResults: 100,
      historyTypes: ['messageAdded'],
      ...(pageToken && { pageToken })
    };

    logger.debug('Fetching history with params', {
      startHistoryId,
      pageToken,
      maxResults: params.maxResults
    });

    const history = await gmail.users.history.list(params);
    
    logger.debug('History data received', {
      hasHistory: !!history.data.history,
      messageCount: history.data.history?.length || 0,
      hasNextPage: !!history.data.nextPageToken
    });

    return history.data;
  } catch (error) {
    // Handle specific error cases
    if (error.code === 404) {
      logger.warn('History ID not found, reinitializing', { startHistoryId });
      return null;
    }
    throw error;
  }
}

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
      threadId: message.threadId
    });

    return message;
  } catch (error) {
    logger.error('Error getting latest message:', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

async function processHistoryItem(auth, item, retryCount = 0) {
  try {
    if (!item.messages || processedHistoryIds.has(item.id)) {
      return true;
    }

    logger.info('Processing history item', {
      historyId: item.id,
      messageCount: item.messages.length,
      messages: item.messages.map(m => ({
        id: m.id,
        threadId: m.threadId
      }))
    });

    // Process messages in parallel
    const results = await Promise.all(
      item.messages.map(async message => {
        try {
          logger.info('Processing message', {
            messageId: message.id,
            threadId: message.threadId
          });
          return await processMessage(auth, message.id);
        } catch (error) {
          logger.error('Error processing message:', {
            error: error.message,
            messageId: message.id,
            stack: error.stack
          });
          return false;
        }
      })
    );

    // Track processed history ID
    processedHistoryIds.add(item.id);

    // Clean up processed history IDs periodically
    if (processedHistoryIds.size > 1000) {
      const oldestIds = Array.from(processedHistoryIds).slice(0, 500);
      oldestIds.forEach(id => processedHistoryIds.delete(id));
    }

    return results.every(result => result === true);
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn('Retrying history item processing', {
        historyId: item.id,
        retryCount,
        error: error.message
      });
      
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return processHistoryItem(auth, item, retryCount + 1);
    }
    
    throw error;
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

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      lastHistoryId = await initializeHistoryId(auth);
    }

    // Try to fetch history first
    let historyData = await fetchHistory(auth, lastHistoryId);
    let processedAny = false;

    // If no history (might be first message), try to get latest message directly
    if (!historyData?.history || historyData.history.length === 0) {
      const latestMessage = await getLatestMessage(auth, decodedData.historyId);
      if (latestMessage) {
        logger.info('Processing single message', {
          messageId: latestMessage.id,
          threadId: latestMessage.threadId
        });
        
        const success = await processMessage(auth, latestMessage.id);
        if (success) {
          processedAny = true;
        }
      }
    } else {
      // Process history if available
      for (const item of historyData.history) {
        const success = await processHistoryItem(auth, item);
        if (success) processedAny = true;
      }
    }

    // Update lastHistoryId after successful processing
    if (processedAny) {
      lastHistoryId = decodedData.historyId;
      logger.info('Updated history ID', { historyId: lastHistoryId });
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
      lastHistoryId
    });
    throw error;
  }
}