import { logger } from '../../../utils/logger.js';
import { SHEET_NAMES } from '../config.js';
import { getSheetAuth } from '../auth.js';
import { initializeChatSheet } from './initialize.js';
import { appendToSheet } from '../utils.js';

export async function logChatConversation(conversationData) {
  try {
    const timestamp = new Date().toISOString();
    const { auth, spreadsheetId } = await getSheetAuth();

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

    await appendToSheet(auth, spreadsheetId, `${SHEET_NAMES.CHAT}!A2:H`, values);

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
      timestamp,
      data: {
        clientId: conversationData.clientId,
        conversationId: conversationData.conversationId
      }
    });
  }
}