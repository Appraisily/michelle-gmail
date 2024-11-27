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