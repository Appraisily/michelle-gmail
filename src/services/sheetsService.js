import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

const sheets = google.sheets('v4');
let auth = null;

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
    // Don't throw the error to prevent breaking the main flow
    // Just log it and continue
  }
}