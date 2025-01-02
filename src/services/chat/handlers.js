import { logger } from '../../utils/logger.js';
import { connectionManager } from './connection/manager.js';
import { MessageType, ConnectionState } from './connection/types.js';
import { processChat } from './processor.js';
import { validateAndPrepareImages } from './handlers/imageHandler.js';
import { getCurrentTimestamp } from './utils/timeUtils.js';
import { logChatConversation } from './utils/loggingUtils.js';

export async function handleMessage(ws, data, client) {
  try {
    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Attempted to handle message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: getCurrentTimestamp()
      });
      return;
    }

    const message = JSON.parse(data);

    // Update activity timestamp for ALL message types
    client.lastActivity = Date.now();

    // Handle confirmation messages
    if (message.type === MessageType.CONFIRM) {
      connectionManager.confirmMessageDelivery(message.messageId);
      return;
    }

    // Handle system messages
    if (message.type === MessageType.PING || 
        message.type === MessageType.PONG || 
        message.type === MessageType.STATUS) {
      return;
    }

    // Update message count for non-system messages
    if (message.type === MessageType.MESSAGE) {
      client.messageCount = (client.messageCount || 0) + 1;
    }

    logger.info('Processing chat message', {
      clientId: client.id,
      conversationId: client.conversationId,
      hasContent: !!message.content,
      hasImages: !!message.images?.length,
      messageId: message.messageId,
      messageType: message.type,
      timestamp: getCurrentTimestamp()
    });

    // Send delivery confirmation
    await connectionManager.sendMessage(ws, {
      type: MessageType.CONFIRM,
      clientId: client.id,
      messageId: message.messageId,
      status: 'received',
      timestamp: getCurrentTimestamp()
    });

    // Send typing indicator
    await connectionManager.sendMessage(ws, {
      type: MessageType.STATUS,
      clientId: client.id,
      status: 'typing',
      timestamp: getCurrentTimestamp(),
      messageId: message.messageId
    });

    // Handle images if present
    if (message.images?.length > 0) {
      const validation = validateAndPrepareImages(message.images);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }
      message.images = validation.images;
      client.imageCount = (client.imageCount || 0) + message.images.length;
    }

    // Store message in conversation history
    if (!client.messages) {
      client.messages = [];
    }

    if (message.content || message.images?.length > 0) {
      // Log user message immediately
      client.messages.push({
        role: 'user',
        content: message.content || '',
        hasImages: !!message.images?.length,
        timestamp: getCurrentTimestamp(),
        messageId: message.messageId
      });
    }

    // Process message
    const response = await processChat(message, client.id);

    // Store assistant response immediately
    client.messages.push({
      role: 'assistant',
      content: response.content,
      timestamp: getCurrentTimestamp(),
      messageId: response.messageId
    });

    // Send response
    await connectionManager.sendMessage(ws, {
      type: MessageType.RESPONSE,
      clientId: client.id,
      messageId: response.messageId,
      content: response.content,
      replyTo: message.messageId,
      timestamp: getCurrentTimestamp()
    });

    // Send idle status
    await connectionManager.sendMessage(ws, {
      type: MessageType.STATUS,
      clientId: client.id,
      status: 'idle',
      timestamp: getCurrentTimestamp(),
      messageId: message.messageId
    });

  } catch (error) {
    logger.error('Error handling message', {
      error: error.message,
      clientId: client?.id,
      messageId: message?.messageId,
      stack: error.stack,
      timestamp: getCurrentTimestamp()
    });

    try {
      if (ws.readyState === ConnectionState.OPEN) {
        await connectionManager.sendMessage(ws, {
          type: MessageType.ERROR,
          clientId: client?.id,
          messageId: message?.messageId,
          error: 'An error occurred while processing your message',
          timestamp: getCurrentTimestamp()
        });
      }
    } catch (sendError) {
      logger.error('Failed to send error message', {
        error: sendError.message,
        clientId: client?.id,
        stack: sendError.stack,
        timestamp: getCurrentTimestamp()
      });
    }
  }
}