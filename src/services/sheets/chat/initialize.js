import { sheets, SHEET_NAMES, MAX_RETRIES, RETRY_DELAY } from '../config.js';
import { verifySheetExists } from '../utils.js';
import { logger } from '../../../utils/logger.js';

export async function initializeChatSheet(auth, spreadsheetId) {
  try {
    let retryCount = 0;
    let sheetExists = false;

    while (retryCount < MAX_RETRIES) {
      sheetExists = await verifySheetExists(auth, spreadsheetId, SHEET_NAMES.CHAT);
      if (sheetExists) break;

      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }

      logger.info('Creating Chat sheet', {
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES
      });

      try {
        const headers = [
          ['Timestamp', 'Client ID', 'Conversation ID', 'Duration (seconds)', 
           'Message Count', 'Image Count', 'Conversation', 'Has Images']
        ];

        await sheets.spreadsheets.batchUpdate({
          auth,
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: { 
                properties: {
                  title: SHEET_NAMES.CHAT
                }
              }
            }]
          }
        });

        await sheets.spreadsheets.values.append({
          auth,
          spreadsheetId,
          range: `${SHEET_NAMES.CHAT}!A1:H1`,
          valueInputOption: 'RAW',
          requestBody: { values: headers }
        });

        sheetExists = await verifySheetExists(auth, spreadsheetId, SHEET_NAMES.CHAT);
        if (sheetExists) {
          logger.info('Chat sheet created successfully');
          break;
        }
      } catch (error) {
        logger.warn('Failed to create Chat sheet, retrying:', {
          error: error.message,
          attempt: retryCount + 1
        });
      }

      retryCount++;
    }

    if (!sheetExists) {
      throw new Error('Failed to initialize Chat sheet after multiple attempts');
    }
  } catch (error) {
    logger.error('Error initializing chat sheet:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}