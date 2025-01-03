import { logger } from '../../utils/logger.js';
import { connectionManager } from './connection/manager.js';
import { logChatSession } from './utils/loggingUtils.js';
import { processChat } from './processor.js';
import { validateAndPrepareImages } from './handlers/imageHandler.js';
import { getCurrentTimestamp } from './utils/timeUtils.js';
import { MessageType } from './connection/types.js';

export async function handleMessage(ws, data, client) {
  try {
    const parsedData = JSON.parse(data);

    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Attempted to handle message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: getCurrentTimestamp()
      });
      return;
    }

    // Update activity timestamp for ALL message types
    client.lastActivity = Date.now();

    // Handle confirmation messages
    if (parsedData.type === MessageType.CONFIRM) {
      connectionManager.confirmMessageDelivery(parsedData.messageId);
      return;
    }

    // Handle system messages
    if (parsedData.type === MessageType.PING || 
        parsedData.type === MessageType.PONG || 
        parsedData.type === MessageType.STATUS) {
      return;
    }

    // Update message count for non-system messages
    if (parsedData.type === MessageType.MESSAGE) {
      client.messageCount = (client.messageCount || 0) + 1;
    }

    logger.info('Processing chat message', {
      clientId: client.id,
      conversationId: client.conversationId,
      hasContent: !!parsedData.content,
      hasImages: !!parsedData.images?.length,
      messageId: parsedData.messageId,
      messageType: parsedData.type,
      timestamp: getCurrentTimestamp()
    });

    // Send delivery confirmation
    await connectionManager.sendMessage(ws, {
      type: MessageType.CONFIRM,
      clientId: client.id,
      messageId: parsedData.messageId,
      status: 'received',
      timestamp: getCurrentTimestamp()
    });

    // Send typing indicator
    await connectionManager.sendMessage(ws, {
      type: MessageType.STATUS,
      clientId: client.id,
      status: 'typing',
      timestamp: getCurrentTimestamp(),
      messageId: parsedData.messageId
    });

    // Handle images if present
    if (parsedData.images?.length > 0) {
      const validation = validateAndPrepareImages(parsedData.images);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }
      parsedData.images = validation.images;
      client.imageCount = (client.imageCount || 0) + parsedData.images.length;
    }

    // Store message in conversation history
    if (!client.messages) {
      client.messages = [];
    }

    if (parsedData.content || parsedData.images?.length > 0) {
      // Log user message immediately
      client.messages.push({
        role: 'user',
        content: parsedData.content || '',
        hasImages: !!parsedData.images?.length,
        timestamp: getCurrentTimestamp(),
        messageId: parsedData.messageId
      });
    }

    // Process message
    const response = await processChat(parsedData, client.id);

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
      replyTo: parsedData.messageId,
      timestamp: getCurrentTimestamp()
    });

    // Send idle status
    await connectionManager.sendMessage(ws, {
      type: MessageType.STATUS,
      clientId: client.id,
      status: 'idle',
      timestamp: getCurrentTimestamp(),
      messageId: parsedData.messageId
    });

  } catch (error) {
    logger.error('Error handling message', {
      error: error.message,
      clientId: client?.id,
      messageId: parsedData?.messageId,
      stack: error.stack,
      timestamp: getCurrentTimestamp()
    });

    try {
      if (ws.readyState === ConnectionState.OPEN) {
        await connectionManager.sendMessage(ws, {
          type: MessageType.ERROR,
          clientId: client?.id,
          messageId: parsedData?.messageId,
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