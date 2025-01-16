import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

export async function logEmailProcessing(logData) {
  try {
    const secrets = await getSecrets();
    const spreadsheetId = secrets.SHEETS_ID_MICHELLE_CHAT_LOG;

    if (!spreadsheetId) {
      throw new Error('SHEETS_ID_MICHELLE_CHAT_LOG not found in secrets');
    }

    // Use default credentials from compute engine
    const auth = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Initialize Logs sheet if needed
    await initializeLogsSheet(auth, spreadsheetId);

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

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Logs!A2:L',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
      }
    });

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

async function initializeLogsSheet(auth, spreadsheetId) {
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
      const headers = [
        ['Timestamp', 'Message ID', 'Sender', 'Subject', 'Has Images', 'Requires Reply', 
         'Classification', 'Reason', 'Intent', 'Urgency', 'Response Type', 'Generated Reply']
      ];

      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: 'Logs'
                }
              }
            }
          ]
        }
      });

      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: 'Logs!A1:L1',
        valueInputOption: 'RAW',
        requestBody: {
          values: headers
        }
      });

      logger.info('Created Logs sheet with headers');
    }
  } catch (error) {
    logger.error('Error initializing logs sheet:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function verifySheetExists(auth, spreadsheetId, sheetTitle) {
  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });

    const sheet = response.data.sheets.find(
      s => s.properties.title === sheetTitle
    );

    return !!sheet;
  } catch (error) {
    logger.error('Error verifying sheet existence:', {
      error: error.message,
      sheetTitle,
      stack: error.stack
    });
    return false;
  }
}

export async function logChatConversation(conversationData) {
  try {
    const timestamp = new Date().toISOString();
    const secrets = await getSecrets();
    const spreadsheetId = secrets.SHEETS_ID_MICHELLE_CHAT_LOG;

    if (!spreadsheetId) {
      throw new Error('SHEETS_ID_MICHELLE_CHAT_LOG not found in secrets');
    }

    // Use default credentials from compute engine
    const auth = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Initialize Chat sheet if needed
    await initializeChatSheet(auth, spreadsheetId);

    const values = [[
      timestamp,
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
      timestamp
    });
  } catch (error) {
    logger.error('Error logging chat conversation:', {
      error: error.message,
      stack: error.stack,
      timestamp: timestamp,
      data: {
        clientId: conversationData.clientId,
        conversationId: conversationData.conversationId
      }
    });
  }
}

async function initializeChatSheet(auth, spreadsheetId) {
  try {
    let retryCount = 0;
    let sheetExists = false;

    while (retryCount < MAX_RETRIES) {
      sheetExists = await verifySheetExists(auth, spreadsheetId, 'Chat');
      if (sheetExists) break;

      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }

      logger.info('Creating Chat sheet', {
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES
      });

      try {
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

        // Verify creation was successful
        sheetExists = await verifySheetExists(auth, spreadsheetId, 'Chat');
        if (sheetExists) {
          logger.info('Chat sheet created successfully');
          break;
        }
      } catch (error) {
        logger.warn('Failed to create Chat sheet, retrying:', {
          error: error.message,
          attempt: retryCount + 1
        });
      }

      retryCount++;
    }

    if (!sheetExists) {
      throw new Error('Failed to initialize Chat sheet after multiple attempts');
    }
  } catch (error) {
    logger.error('Error initializing chat sheet:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

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

export async function logChatSession(logData) {
  try {
    if (!logData?.clientId || !logData?.conversationId) {
      throw new Error('Missing required logging data');
    }

    const secrets = await getSecrets();
    const spreadsheetId = secrets.SHEETS_ID_MICHELLE_CHAT_LOG;

    if (!spreadsheetId) {
      throw new Error('SHEETS_ID_MICHELLE_CHAT_LOG not found in secrets');
    }

    // Use default credentials from compute engine
    const auth = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Verify sheet exists before attempting to log
    const sheetExists = await verifySheetExists(auth, spreadsheetId, 'Chat');
    if (!sheetExists) {
      logger.info('Chat sheet not found, initializing...');
    }

    await initializeChatSheet(auth, spreadsheetId);

    logger.info('Logging chat session to Google Sheets', {
      spreadsheetId,
      clientId: logData.clientId,
      conversationId: logData.conversationId,
      messageCount: logData.messageCount
    });

    const values = [[
      logData.timestamp,
      logData.clientId,
      logData.conversationId,
      logData.duration,
      logData.messageCount,
      logData.imageCount,
      JSON.stringify(logData.conversation),
      logData.hasImages ? 'Yes' : 'No',
      logData.metadata?.type || 'CHAT',
      logData.metadata?.urgency || 'medium',
      logData.metadata?.labels || '',
      logData.disconnectReason || 'normal'
    ]];

    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range: 'Chat!A2:L',
      valueInputOption: 'USER_ENTERED', // This ensures proper date/time parsing
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values
      }
    });

    logger.info('Chat session logged successfully', {
      clientId: logData.clientId,
      conversationId: logData.conversationId,
      timestamp: logData.timestamp,
      messageCount: logData.messageCount
    });
  } catch (error) {
    logger.error('Error logging chat session:', {
      error: error.message,
      stack: error.stack,
      data: {
        clientId: logData.clientId,
        conversationId: logData.conversationId,
        timestamp: logData.timestamp
      }
    });
    throw error;
  }
}