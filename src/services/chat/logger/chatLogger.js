import { google } from 'googleapis';
import { logger } from '../../../utils/logger.js';
import { getSecrets } from '../../../utils/secretManager.js';

const sheets = google.sheets('v4');

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

    // Initialize sheet if needed
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