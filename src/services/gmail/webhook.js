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

async function processHistoryItem(auth, item, retryCount = 0) {
  try {
    if (!item.messages || processedHistoryIds.has(item.id)) {
      return;
    }

    logger.info('Processing history item', {
      historyId: item.id,
      messageCount: item.messages.length
    });

    // Sort messages by timestamp, newest first
    const sortedMessages = item.messages.sort((a, b) => {
      return parseInt(b.internalDate || '0') - parseInt(a.internalDate || '0');
    });

    // Process latest message immediately
    if (sortedMessages.length > 0) {
      const latestMessage = sortedMessages[0];
      await processMessage(auth, latestMessage.id);
    }

    // Process remaining messages in parallel
    if (sortedMessages.length > 1) {
      const remainingMessages = sortedMessages.slice(1);
      await Promise.all(
        remainingMessages.map(message => 
          processMessage(auth, message.id)
        )
      );
    }

    // Track processed history ID
    processedHistoryIds.add(item.id);

    // Clean up processed history IDs periodically
    if (processedHistoryIds.size > 1000) {
      const oldestIds = Array.from(processedHistoryIds).slice(0, 500);
      oldestIds.forEach(id => processedHistoryIds.delete(id));
    }

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

    // Validate history ID
    const receivedHistoryId = parseInt(decodedData.historyId);
    if (lastHistoryId && receivedHistoryId <= parseInt(lastHistoryId)) {
      logger.warn('Received older history ID, skipping', {
        current: lastHistoryId,
        received: receivedHistoryId
      });
      return;
    }

    logger.debug('Received webhook notification', {
      historyId: receivedHistoryId,
      messageId: data.message.messageId,
      publishTime: data.message.publishTime
    });

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      lastHistoryId = await initializeHistoryId(auth);
    }

    // Fetch and process history with pagination
    let pageToken = null;
    do {
      logger.info('Fetching history page', { 
        startHistoryId: lastHistoryId,
        pageToken 
      });

      const historyData = await fetchHistory(auth, lastHistoryId, pageToken);
      
      // Handle case where history ID is invalid/expired
      if (!historyData) {
        lastHistoryId = await initializeHistoryId(auth);
        continue;
      }

      if (historyData.history) {
        // Process each history item
        for (const item of historyData.history) {
          await processHistoryItem(auth, item);
        }
      }

      pageToken = historyData.nextPageToken;
    } while (pageToken);

    // Update lastHistoryId after successful processing
    lastHistoryId = receivedHistoryId;
    logger.info('Updated history ID', { historyId: lastHistoryId });

  } catch (error) {
    logger.error('Webhook processing failed:', {
      error: error.message,
      stack: error.stack,
      lastHistoryId
    });
    throw error;
  }
}