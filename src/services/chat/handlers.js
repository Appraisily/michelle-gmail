import { logger } from '../../utils/logger.js';
import { connectionManager } from './connection/manager.js';
import { MessageType, ConnectionState } from './connection/types.js';
import { processChat } from './processor.js';
import { validateMessage } from './validators/messageValidator.js';
import { validateAndPrepareImages } from './handlers/imageHandler.js';
import { handleDisconnectRequest } from './connection/connectionHandler.js';
import { 
  handleMessageError, 
  handleValidationError, 
  handleWebSocketError 
} from './errors/errorHandler.js';

export async function handleMessage(ws, data, client) {
  try {
    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Attempted to handle message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const message = JSON.parse(data);

    // Validate message format
    const validationResult = validateMessage(message);
    if (!validationResult.isValid) {
      await handleValidationError(ws, client, message.messageId, validationResult.errors);
      return;
    }

    // Handle disconnect request
    if (message.type === MessageType.DISCONNECT) {
      await handleDisconnectRequest(ws, message);
      return;
    }

    // Update client state
    client.lastMessage = Date.now();
    client.messageCount++;

    logger.info('Processing chat message', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageId: message.messageId,
      messageType: message.type,
      hasContent: !!message.content,
      hasImages: !!message.images?.length,
      timestamp: new Date().toISOString()
    });

    // Send delivery confirmation
    await connectionManager.sendMessage(ws, {
      type: MessageType.CONFIRM,
      clientId: client.id,
      messageId: message.messageId,
      status: 'received',
      timestamp: new Date().toISOString()
    });

    // Validate and prepare images if present
    if (message.images?.length > 0) {
      const imageValidation = validateAndPrepareImages(message.images);
      if (!imageValidation.isValid) {
        await handleValidationError(ws, client, message.messageId, imageValidation.errors);
        return;
      }
      message.images = imageValidation.images;
    }

    // Process message
    const response = await processChat(message, client.id);
    if (response) {
      await connectionManager.sendMessage(ws, {
        type: MessageType.RESPONSE,
        clientId: client.id,
        messageId: response.messageId,
        content: response.content,
        replyTo: message.messageId,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    await handleMessageError(ws, error, client, message?.messageId);
  }
}