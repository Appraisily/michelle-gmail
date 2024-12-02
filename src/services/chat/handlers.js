import { logger } from '../../utils/logger.js';
import { connectionManager } from './connection/manager.js';
import { MessageType, ConnectionState } from './connection/types.js';
import { processChat } from './processor.js';
import { validateAndPrepareImages } from './handlers/imageHandler.js';
import { getCurrentTimestamp } from './utils/timeUtils.js';

/**
 * Handle message error
 */
async function handleMessageError(ws, error, client, messageId) {
  logger.error('Error handling message', {
    error: error.message,
    clientId: client?.id,
    messageId,
    stack: error.stack,
    timestamp: getCurrentTimestamp()
  });

  try {
    if (ws.readyState === ConnectionState.OPEN) {
      await connectionManager.sendMessage(ws, {
        type: MessageType.ERROR,
        clientId: client?.id,
        messageId,
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

/**
 * Handle incoming messages
 */
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

    // Update client state for ALL message types
    client.lastMessage = Date.now();

    // Handle confirmation messages
    if (message.type === MessageType.CONFIRM) {
      connectionManager.confirmMessageDelivery(message.messageId);
      return;
    }

    // Handle system messages
    if (message.type === MessageType.PING || 
        message.type === MessageType.PONG || 
        message.type === MessageType.STATUS) {
      // Just confirm receipt for system messages
      await connectionManager.sendMessage(ws, {
        type: MessageType.CONFIRM,
        clientId: client.id,
        messageId: message.messageId,
        status: 'received',
        timestamp: getCurrentTimestamp()
      });
      return;
    }

    // Log incoming message
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
        await handleMessageError(ws, new Error(validation.errors.join(', ')), client, message.messageId);
        return;
      }
      message.images = validation.images;
      client.imageCount = (client.imageCount || 0) + message.images.length;
    }

    // Store message in conversation history
    if (!client.messages) {
      client.messages = [];
    }
    client.messages.push({
      type: 'user',
      content: message.content,
      hasImages: !!message.images?.length,
      timestamp: getCurrentTimestamp()
    });

    // Process message
    const response = await processChat(message, client.id);

    // Store response in conversation history
    client.messages.push({
      type: 'assistant',
      content: response.content,
      timestamp: getCurrentTimestamp()
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
    await handleMessageError(ws, error, client, message?.messageId);
  }
}