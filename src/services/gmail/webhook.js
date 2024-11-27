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

    logger.debug('History data received:', {
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

async function processHistoryItem(auth, item, retryCount = 0) {
  try {
    if (!item.messages || processedHistoryIds.has(item.id)) {
      return;
    }

    logger.debug('Processing history item', {
      historyId: item.id,
      messageCount: item.messages.length,
      messages: item.messages.map(m => ({
        id: m.id,
        threadId: m.threadId,
        labelIds: m.labelIds
      }))
    });

    // Process messages in parallel
    const results = await Promise.all(
      item.messages.map(message => 
        processMessage(auth, message.id)
      )
    );

    // Track processed history ID
    processedHistoryIds.add(item.id);

    // Clean up processed history IDs periodically
    if (processedHistoryIds.size > 1000) {
      const oldestIds = Array.from(processedHistoryIds).slice(0, 500);
      oldestIds.forEach(id => processedHistoryIds.delete(id));
      logger.debug('Cleaned up processed history IDs', {
        removed: oldestIds.length,
        remaining: processedHistoryIds.size
      });
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

    logger.debug('Decoded Pub/Sub data:', {
      historyId: decodedData.historyId,
      emailAddress: decodedData.emailAddress
    });

    // Use notification historyId as starting point if no lastHistoryId
    const startHistoryId = lastHistoryId || decodedData.historyId;

    // Fetch and process history with pagination
    let pageToken = null;
    do {
      logger.info('Fetching history page', { 
        startHistoryId,
        pageToken 
      });

      const historyData = await fetchHistory(auth, startHistoryId, pageToken);
      
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
    lastHistoryId = decodedData.historyId;
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