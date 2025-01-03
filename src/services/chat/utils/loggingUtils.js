import { logger } from '../../../utils/logger.js';
import { logEmailProcessing } from '../../sheetsService.js';

export async function logChatSession(client, reason = 'disconnect') {
  if (!client.messages?.length) {
    logger.debug('No messages to log', {
      clientId: client.id,
      conversationId: client.conversationId
    });
    return;
  }

  try {
    const duration = Math.floor((Date.now() - client.connectedAt) / 1000);

    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      messageId: client.id,
      sender: client.id,
      subject: `Chat Session ${client.conversationId}`,
      hasImages: (client.imageCount || 0) > 0,
      requiresReply: false,
      reply: JSON.stringify(client.messages),
      reason: reason,
      classification: {
        intent: 'CHAT_SESSION',
        urgency: 'medium',
        suggestedResponseType: 'none'
      },
      threadId: client.conversationId,
      labels: `chat,${reason}`
    });

    logger.info('Chat session logged successfully', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messages.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to log chat session:', {
      error: error.message,
      clientId: client.id,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Log chat conversation to Google Sheets
 * @param {Object} client Client data object
 * @param {string} reason Reason for logging (disconnect/timeout)
 */
export async function logChatSession(client, reason = 'disconnect') {
  if (!client.messages?.length) {
    logger.debug('No messages to log', {
      clientId: client.id,
      conversationId: client.conversationId
    });
    return;
  }

  try {
    const duration = Math.floor((Date.now() - client.connectedAt) / 1000);

    await logChatConversation({
      timestamp: new Date().toISOString(),
      clientId: client.id,
      conversationId: client.conversationId,
      duration,
      messageCount: client.messages.length,
      imageCount: client.imageCount || 0,
      hasImages: (client.imageCount || 0) > 0,
      conversation: client.messages,
      disconnectReason: reason
    });

    logger.info('Chat conversation logged successfully', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messages.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to log chat conversation:', {
      error: error.message,
      clientId: client.id,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}