import { logger } from '../../../utils/logger.js';
import { logChatConversation as logToSheets } from '../../sheets/index.js';

export async function logChatSession(client, reason = 'disconnect') {
  if (!client.messages?.length) {
    logger.debug('No messages to log', {
      clientId: client.id,
      conversationId: client.conversationId
    });
    return;
  }

  try {
    const now = new Date();
    const timestamp = now.toISOString();
    const duration = Math.floor((Date.now() - client.connectedAt) / 1000);

    await logToSheets({
      timestamp,
      clientId: client.id,
      conversationId: client.conversationId,
      duration,
      messageCount: client.messages.length,
      imageCount: client.imageCount || 0,
      hasImages: (client.imageCount || 0) > 0,
      conversation: client.messages,
      disconnectReason: reason,
      metadata: {
        type: 'CHAT_SESSION',
        urgency: 'medium',
        labels: `chat,${reason}`
      }
    });

    logger.info('Chat session logged successfully', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messages.length,
      timestamp,
      duration
    });
  } catch (error) {
    logger.error('Failed to log chat session:', {
      error: error.message,
      clientId: client.id,
      stack: error.stack,
      timestamp
    });
  }
}