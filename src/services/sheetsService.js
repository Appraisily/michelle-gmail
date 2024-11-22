import { google } from 'googleapis';
import { logger } from '../utils/logger.js';

const sheets = google.sheets('v4');

export async function logEmailProcessing(logData) {
  try {
    const auth = await getSheetAuth();
    
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.SHEET_ID,
      range: 'Logs!A:E',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          logData.timestamp,
          logData.sender,
          logData.subject,
          logData.requiresReply ? 'Yes' : 'No',
          logData.reply
        ]]
      }
    });

    logger.info('Email processing logged successfully');
  } catch (error) {
    logger.error('Error logging to Google Sheets:', error);
    throw error;
  }
}