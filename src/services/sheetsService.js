import { google } from 'googleapis';
import { logger } from '../utils/logger.js';

const sheets = google.sheets('v4');
let auth = null;

async function getSheetAuth() {
  if (!auth) {
    try {
      // Use Google Cloud's built-in authentication
      const googleAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      auth = await googleAuth.getClient();
      logger.info('Google Sheets authentication initialized');
    } catch (error) {
      logger.error('Failed to initialize Google Sheets auth', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  return auth;
}

export async function logEmailProcessing(logData) {
  try {
    const auth = await getSheetAuth();
    const spreadsheetId = process.env.MICHELLE_CHAT_LOG_SPREADSHEETID;

    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID not found in environment variables');
    }

    logger.info('Logging to Google Sheets', {
      spreadsheetId,
      sender: logData.sender,
      subject: logData.subject
    });

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
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

    logger.info('Email processing logged successfully', {
      spreadsheetId,
      timestamp: logData.timestamp
    });
  } catch (error) {
    logger.error('Error logging to Google Sheets', {
      error: error.message,
      stack: error.stack,
      data: {
        sender: logData.sender,
        subject: logData.subject,
        timestamp: logData.timestamp
      }
    });
  }
}