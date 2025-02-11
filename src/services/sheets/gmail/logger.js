import { logger } from '../../../utils/logger.js';
import { SHEET_NAMES } from '../config.js';
import { getSheetAuth } from '../auth.js';
import { initializeGmailSheet } from './initialize.js';
import { appendToSheet } from '../utils.js';

export async function logEmailProcessing(logData) {
  try {
    const { auth, spreadsheetId } = await getSheetAuth();
    
    await initializeGmailSheet(auth, spreadsheetId);

    const values = [[
      logData.timestamp,
      logData.messageId,
      logData.sender,
      logData.subject,
      logData.hasImages ? 'Yes' : 'No',
      logData.requiresReply ? 'Yes' : 'No',
      logData.classification?.intent || '',
      logData.reason || '',
      logData.classification?.intent || '',
      logData.classification?.urgency || '',
      logData.classification?.suggestedResponseType || '',
      logData.reply || ''
    ]];

    await appendToSheet(auth, spreadsheetId, `${SHEET_NAMES.GMAIL}!A2:L`, values);

    logger.info('Email processing logged successfully', {
      messageId: logData.messageId,
      sender: logData.sender,
      timestamp: logData.timestamp
    });
  } catch (error) {
    logger.error('Error logging email processing:', {
      error: error.message,
      stack: error.stack,
      data: {
        messageId: logData.messageId,
        sender: logData.sender
      }
    });
  }
}