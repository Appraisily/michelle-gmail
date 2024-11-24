import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

const sheets = google.sheets('v4');

async function initializeSheet(auth, spreadsheetId) {
  try {
    // Check if the Logs sheet exists
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });

    const logsSheet = response.data.sheets.find(
      sheet => sheet.properties.title === 'Logs'
    );

    if (!logsSheet) {
      // Create the Logs sheet with headers
      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Logs',
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10
                }
              }
            }
          }]
        }
      });

      // Add headers
      const headers = [
        ['Timestamp', 'Sender', 'Subject', 'Requires Reply', 'Reason', 
         'Intent', 'Urgency', 'Response Type', 'Tone', 'Reply']
      ];

      await sheets.spreadsheets.values.update({
        auth,
        spreadsheetId,
        range: 'Logs!A1:J1',
        valueInputOption: 'RAW',
        requestBody: {
          values: headers
        }
      });

      logger.info('Created Logs sheet with headers');
    }
  } catch (error) {
    logger.error('Error initializing sheet:', error);
    throw error;
  }
}

export async function logEmailProcessing(logData) {
  try {
    const secrets = await getSecrets();
    const spreadsheetId = secrets.MICHELLE_CHAT_LOG_SPREADSHEETID;

    if (!spreadsheetId) {
      throw new Error('MICHELLE_CHAT_LOG_SPREADSHEETID not found in secrets');
    }

    // Use default credentials from compute engine
    const auth = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Initialize sheet if needed
    await initializeSheet(auth, spreadsheetId);

    logger.info('Logging to Google Sheets', {
      spreadsheetId,
      sender: logData.sender,
      subject: logData.subject
    });

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York'
    });

    const values = [[
      timestamp,
      logData.sender,
      logData.subject,
      logData.requiresReply ? 'Yes' : 'No',
      logData.reason,
      logData.analysis?.intent || 'N/A',
      logData.analysis?.urgency || 'N/A',
      logData.analysis?.suggestedResponseType || 'N/A',
      logData.responseData?.tone || 'N/A',
      logData.reply || 'No reply needed'
    ]];

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Logs!A2:J',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
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
  }
}