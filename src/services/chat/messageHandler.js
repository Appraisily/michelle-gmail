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
    // Verify WebSocket exists and is in OPEN state
    if (!ws || ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Cannot send message - connection not in OPEN state', {
        clientId: message.clientId,
        readyState: ws?.readyState,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });
      return false;
    }

    // Double check connection is active in manager
    if (!connectionManager.state.isConnectionActive(ws)) {
      logger.warn('Cannot send message - connection not active in manager', {
        clientId: message.clientId,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });
      return false;
    }

    // Get client info to verify connection status
    const client = connectionManager.getConnectionInfo(ws);
    if (!client) {
      logger.warn('Cannot send message - no client info found', {
        clientId: message.clientId,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });
      return false;
    }

    // Send through connection manager which handles queuing and retries
    const sent = await connectionManager.sendMessage(ws, message);
    if (!sent) {
      throw new Error('Failed to send message through connection manager');
    }

    logger.info('Message sent successfully', {
      clientId: message.clientId,
      messageType: message.type,
      messageId: message.messageId,
      timestamp: new Date().toISOString()
    });

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
    // Verify connection state before processing
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