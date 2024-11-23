import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

const sheets = google.sheets('v4');
let auth = null;
let spreadsheetId = null;

async function getSheetAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    auth = oauth2Client;
  }
  return auth;
}

async function getSpreadsheetId() {
  if (!spreadsheetId) {
    const secrets = await getSecrets();
    spreadsheetId = secrets.MICHELLE_CHAT_LOG_SPREADSHEETID;
    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID not found in secrets');
    }
    logger.info('Retrieved spreadsheet ID from secrets');
  }
  return spreadsheetId;
}

export async function logEmailProcessing(logData) {
  try {
    const auth = await getSheetAuth();
    const sheetId = await getSpreadsheetId();
    
    logger.info('Logging to Google Sheets', {
      spreadsheetId: sheetId,
      sender: logData.sender,
      subject: logData.subject
    });

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: sheetId,
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
      spreadsheetId: sheetId,
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
    // Don't throw the error to prevent breaking the main flow
  }
}