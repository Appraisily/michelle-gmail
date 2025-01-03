import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

export async function logChatConversation(conversationData) {
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

    // Initialize Chat sheet if needed
    await initializeChatSheet(auth, spreadsheetId);

    const values = [[
      new Date().toISOString(),
      conversationData.clientId,
      conversationData.conversationId,
      conversationData.duration,
      conversationData.messageCount,
      conversationData.imageCount,
      JSON.stringify(conversationData.conversation),
      conversationData.hasImages ? 'Yes' : 'No'
    ]];

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Chat!A2:H',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
      }
    });

    logger.info('Chat conversation logged successfully', {
      clientId: conversationData.clientId,
      conversationId: conversationData.conversationId,
      messageCount: conversationData.messageCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error logging chat conversation:', {
      error: error.message,
      stack: error.stack,
      data: {
        clientId: conversationData.clientId,
        conversationId: conversationData.conversationId
      }
    });
  }
}

async function initializeChatSheet(auth, spreadsheetId) {
  try {
    // Check if the Chat sheet exists
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });

    const chatSheet = response.data.sheets.find(
      sheet => sheet.properties.title === 'Chat'
    );

    if (!chatSheet) {
      // Create the Chat sheet with headers
      const headers = [
        ['Timestamp', 'Client ID', 'Conversation ID', 'Duration (seconds)', 
         'Message Count', 'Image Count', 'Conversation', 'Has Images']
      ];

      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Chat'
                }
              }
            }
          ]
        }
      });

      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: 'Chat!A1:H1',
        valueInputOption: 'RAW',
        requestBody: {
          values: headers
        }
      });

      logger.info('Created Chat sheet with headers');
    }
  } catch (error) {
    logger.error('Error initializing chat sheet:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

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
        ['Timestamp', 'Message ID', 'Sender', 'Subject', 'Has Attachments', 'Requires Reply', 'Classification', 'Reason', 
         'Intent', 'Urgency', 'Response Type', 'Generated Reply']
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
                      pattern: 'yyyy-MM-dd HH:mm:ss'
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
      subject: logData.subject,
      hasReply: !!logData.reply
    });

    // Format timestamp as ISO string for proper date/time handling in Sheets
    const timestamp = new Date().toISOString();

    // Determine classification based on intent or presence of images
    const classification = logData.hasImages ? 'APPRAISAL_LEAD' : 'GENERAL_INQUIRY';

    const values = [[
      timestamp,
      logData.messageId || 'N/A',
      logData.sender,
      logData.subject,
      logData.hasImages ? 'Yes' : 'No',
      logData.requiresReply ? 'Yes' : 'No',
      classification,
      logData.reason,
      logData.classification?.intent || 'N/A',
      logData.classification?.urgency || 'N/A',
      logData.classification?.suggestedResponseType || 'N/A',
      logData.reply || 'No reply generated'
    ]];

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Logs!A2:L', // Updated range to include the new column
      valueInputOption: 'USER_ENTERED', // This ensures proper date/time parsing
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
      }
    });

    logger.info('Email processing logged successfully', {
      messageId: logData.messageId,
      timestamp,
      hasAttachments: logData.hasImages ? 'Yes' : 'No',
      classification,
      hasReply: !!logData.reply
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