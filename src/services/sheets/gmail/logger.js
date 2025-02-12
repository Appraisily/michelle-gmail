import { logger } from '../../../utils/logger.js';
import { SHEET_NAMES } from '../config.js';
import { getSheetAuth } from '../auth.js';
import { initializeGmailSheet } from './initialize.js';
import { appendToSheet } from '../utils.js';

export async function logEmailProcessing(logData) {
  try {
    const { auth, spreadsheetId } = await getSheetAuth();
    
    await initializeGmailSheet(auth, spreadsheetId);

    // Extract sender name and email
    const senderMatch = logData.sender.match(/^(?:([^<]*)<)?([^>]+)>?$/);
    const senderName = senderMatch ? senderMatch[1]?.trim() || '' : '';
    const senderEmail = senderMatch ? senderMatch[2]?.trim() || logData.sender : logData.sender;

    const values = [[
      logData.timestamp,
      logData.messageId,
      logData.threadId || '',
      senderEmail,
      senderName,
      logData.subject || '',
      logData.content || '',
      logData.hasImages ? 'Yes' : 'No',
      logData.imageCount || 0,
      logData.classification?.intent || '',
      logData.classification?.urgency || '',
      logData.classification?.suggestedResponseType || '',
      logData.requiresReply ? 'Yes' : 'No',
      logData.generatedReply || '',
      logData.imageAnalysis || '',
      logData.processingTime || '',
      Array.isArray(logData.labels) ? logData.labels.join(', ') : logData.labels || '',
      logData.status || 'Processed',
      logData.error || ''
    ]];

    await appendToSheet(auth, spreadsheetId, `${SHEET_NAMES.GMAIL}!A2:S`, values);

    logger.info('Email processing logged successfully', {
      messageId: logData.messageId,
      threadId: logData.threadId,
      sender: senderEmail,
      timestamp: logData.timestamp
    });
  } catch (error) {
    logger.error('Error logging email processing:', {
      error: error.message,
      stack: error.stack,
      data: {
        messageId: logData.messageId,
        sender: logData.sender
      },
      timestamp: new Date().toISOString()
    });
  }
}