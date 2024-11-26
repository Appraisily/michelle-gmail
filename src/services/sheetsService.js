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
      // Create the Logs sheet with headers and set column formats
      const headers = [
        ['Timestamp', 'Message ID', 'Sender', 'Subject', 'Has Attachments', 'Requires Reply', 'Reason', 
         'Intent', 'Urgency', 'Response Type', 'Tone', 'Reply']
      ];

      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateCells: {
                range: {
                  sheetId: logsSheet.properties.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 12
                },
                rows: [{
                  values: headers[0].map(header => ({
                    userEnteredValue: { stringValue: header },
                    userEnteredFormat: {
                      textFormat: { bold: true },
                      backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
                    }
                  }))
                }],
                fields: 'userEnteredValue,userEnteredFormat'
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: logsSheet.properties.sheetId,
                  startRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 1
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'MM/dd/yyyy HH:mm:ss'
                    }
                  }
                },
                fields: 'userEnteredFormat.numberFormat'
              }
            }
          ]
        }
      });

      logger.info('Created Logs sheet with headers and formatting');
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
      messageId: logData.messageId,
      sender: logData.sender,
      subject: logData.subject
    });

    // Format timestamp as ISO string for proper date/time handling in Sheets
    const timestamp = new Date().toISOString();

    const values = [[
      timestamp, // Sheets will automatically convert ISO string to proper date/time
      logData.messageId || 'N/A',
      logData.sender,
      logData.subject,
      logData.hasImages ? 'Yes' : 'No',
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
      range: 'Logs!A2:L',
      valueInputOption: 'USER_ENTERED', // This ensures proper date/time parsing
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
      }
    });

    logger.info('Email processing logged successfully', {
      spreadsheetId,
      messageId: logData.messageId,
      timestamp,
      hasAttachments: logData.hasImages ? 'Yes' : 'No'
    });
  } catch (error) {
    logger.error('Error logging to Google Sheets:', {
      error: error.message,
      stack: error.stack,
      data: {
        messageId: logData.messageId,
        sender: logData.sender,
        subject: logData.subject,
        timestamp: new Date().toISOString()
      }
    });
  }
}