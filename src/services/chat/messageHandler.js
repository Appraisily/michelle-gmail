import { logger } from '../../utils/logger.js';
import { MessageType, ConnectionState } from './connection/types.js';
import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from './connection/manager.js';

export function createMessage(type, clientId, data = {}) {
  return {
    type,
    clientId,
    timestamp: new Date().toISOString(),
    ...data
  };
}

export async function sendMessage(ws, message) {
  try {
    // Verify connection state before sending
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Cannot send message - connection not in OPEN state', {
        clientId: message.clientId,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
      return false;
    }

    const sent = await connectionManager.sendMessage(ws, message);
    if (!sent) {
      throw new Error('Failed to send message through connection manager');
    }
    return true;
  } catch (error) {
    logger.error('Failed to send message', {
      error: error.message,
      type: message.type,
      clientId: message.clientId,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

export function handleIncomingMessage(ws, data, client) {
  try {
    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Received message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
      return null;
    }

    const message = JSON.parse(data);

    // Validate message format
    if (!message.type || !message.clientId) {
      throw new Error('Invalid message format');
    }

    // Handle message confirmations
    if (message.type === MessageType.CONFIRM) {
      connectionManager.confirmMessageDelivery(ws, message.messageId);
      return null;
    }

    // Add messageId if not present
    if (!message.messageId) {
      message.messageId = uuidv4();
    }

    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    // Update connection activity
    connectionManager.updateActivity(ws);

    logger.debug('Message received', {
      type: message.type,
      clientId: message.clientId,
      messageId: message.messageId,
      timestamp: message.timestamp
    });

    // Send confirmation back to client
    const confirmation = createMessage(MessageType.CONFIRM, client.id, {
      messageId: message.messageId
    });
    connectionManager.sendMessage(ws, confirmation);

    return message;
  } catch (error) {
    logger.error('Error processing incoming message', {
      error: error.message,
      clientId: client?.id,
      data: typeof data === 'string' ? data : 'Invalid data',
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    const errorMessage = createMessage(MessageType.ERROR, client?.id, {
      error: 'Invalid message format',
      details: error.message,
      code: 'MESSAGE_PARSE_ERROR'
    });

    connectionManager.sendMessage(ws, errorMessage);
    return null;
  }
}