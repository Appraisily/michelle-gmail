import { logger } from '../../../utils/logger.js';
import { MessageType, ConnectionState } from '../connection/types.js';
import { connectionManager } from '../connection/manager.js';

/**
 * Handle WebSocket errors
 * @param {WebSocket} ws WebSocket connection
 * @param {Error} error Error object
 * @param {Object} client Client data
 */
export async function handleWebSocketError(ws, error, client) {
  logger.error('WebSocket error:', {
    error: error.message,
    clientId: client?.id,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  try {
    if (ws.readyState === ConnectionState.OPEN) {
      await connectionManager.sendMessage(ws, {
        type: MessageType.ERROR,
        clientId: client?.id,
        error: 'Connection error occurred',
        code: 'WEBSOCKET_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  } catch (sendError) {
    logger.error('Failed to send error message:', {
      error: sendError.message,
      clientId: client?.id,
      stack: sendError.stack,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle message processing errors
 * @param {WebSocket} ws WebSocket connection
 * @param {Error} error Error object
 * @param {Object} client Client data
 * @param {string} messageId Message identifier
 */
export async function handleMessageError(ws, error, client, messageId) {
  logger.error('Message processing error:', {
    error: error.message,
    clientId: client?.id,
    messageId,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  try {
    if (ws.readyState === ConnectionState.OPEN) {
      await connectionManager.sendMessage(ws, {
        type: MessageType.ERROR,
        clientId: client?.id,
        messageId,
        error: 'Failed to process message',
        code: 'MESSAGE_PROCESSING_ERROR',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  } catch (sendError) {
    logger.error('Failed to send error message:', {
      error: sendError.message,
      clientId: client?.id,
      messageId,
      stack: sendError.stack,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle validation errors
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} client Client data
 * @param {string} messageId Message identifier
 * @param {string[]} errors Validation errors
 */
export async function handleValidationError(ws, client, messageId, errors) {
  logger.warn('Message validation failed:', {
    clientId: client?.id,
    messageId,
    errors,
    timestamp: new Date().toISOString()
  });

  try {
    if (ws.readyState === ConnectionState.OPEN) {
      await connectionManager.sendMessage(ws, {
        type: MessageType.ERROR,
        clientId: client?.id,
        messageId,
        error: 'Invalid message format',
        code: 'VALIDATION_ERROR',
        details: errors,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Failed to send validation error:', {
      error: error.message,
      clientId: client?.id,
      messageId,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}