import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

const sheets = google.sheets('v4');
let auth = null;

async function getSheetAuth() {
  if (!auth) {
    try {
      const googleAuth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      
      auth = await googleAuth.getClient();
      logger.info('Google Sheets authentication initialized');
    } catch (error) {
      logger.error('Failed to initialize Google Sheets auth:', error);
      throw error;
    }
  }
  return auth;
}

export async function logEmailProcessing(logData) {
  try {
    const auth = await getSheetAuth();
    const secrets = await getSecrets();
    const spreadsheetId = secrets.MICHELLE_CHAT_LOG_SPREADSHEETID;

    if (!spreadsheetId) {
      throw new Error('MICHELLE_CHAT_LOG_SPREADSHEETID not found in secrets');
    }

    logger.info('Logging to Google Sheets', {
      spreadsheetId,
      sender: logData.sender,
      subject: logData.subject
    });

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York'
    });

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Logs!A:F',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          timestamp,
          logData.sender,
          logData.subject,
          logData.requiresReply ? 'Yes' : 'No',
          logData.reason,
          logData.reply
        ]]
      }
    });

    logger.info('Email processing logged successfully', {
      spreadsheetId,
      timestamp
    });
  } catch (error) {
    logger.error('Error logging to Google Sheets:', {
      error: error.message,
      stack: error.stack,
      data: {
        sender: logData.sender,
        subject: logData.subject,
        timestamp: new Date().toISOString()
      }
    });
    
    // Don't throw the error to prevent webhook failure
    // Just log it and continue
  }
}