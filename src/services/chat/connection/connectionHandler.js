import { logger } from '../../../utils/logger.js';
import { connectionManager } from './manager.js';
import { logChatSession } from '../utils/loggingUtils.js';
import { messageStore } from '../persistence/messageStore.js';
import { logChatConversation } from '../logger/chatLogger.js';
import { v4 as uuidv4 } from 'uuid';

const CONNECTION_TIMEOUT = 5000; // 5 seconds
const RECENT_CONNECTIONS_TTL = 3000; // 3 seconds

// Track recent connections to prevent duplicates
const recentConnections = new Map();

/**
 * Clean up old connection tracking entries
 */
function cleanupRecentConnections() {
  const now = Date.now();
  for (const [id, data] of recentConnections.entries()) {
    if (now - data.timestamp > RECENT_CONNECTIONS_TTL) {
      recentConnections.delete(id);
    }
  }
}

/**
 * Handle initial WebSocket connection
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} message Initial connect message
 * @param {string} clientIp Client IP address
 * @returns {Object|null} Client data if connection successful, null otherwise
 */
export async function handleInitialConnection(ws, message, clientIp) {
  try {
    if (message.type !== MessageType.CONNECT || !message.clientId) {
      throw new Error('Invalid connection message');
    }

    // Check for recent connections from this client
    const recentConnection = recentConnections.get(message.clientId);
    if (recentConnection) {
      const timeSinceLastConnect = Date.now() - recentConnection.timestamp;
      if (timeSinceLastConnect < RECENT_CONNECTIONS_TTL) {
        logger.warn('Rejecting duplicate connection attempt', {
          clientId: message.clientId,
          timeSinceLastConnect,
          ip: clientIp,
          timestamp: new Date().toISOString()
        });
        ws.close(1008, 'Duplicate connection');
        return null;
      }
    }

    // Initialize client data
    const clientData = {
      id: message.clientId,
      ip: clientIp,
      isAlive: true,
      lastPong: Date.now(),
      connectedAt: Date.now(),
      lastMessage: Date.now(),
      messageCount: 0,
      imageCount: 0,
      conversationId: uuidv4(),
      status: ConnectionStatus.PENDING,
      messages: []
    };

    // Add to connection manager
    connectionManager.addConnection(ws, clientData);

    // Track this connection
    recentConnections.set(message.clientId, {
      timestamp: Date.now(),
      conversationId: clientData.conversationId
    });

    // Clean up old connection tracking
    cleanupRecentConnections();

    // Send connection confirmation
    await connectionManager.sendMessage(ws, {
      type: MessageType.CONNECT_CONFIRM,
      clientId: clientData.id,
      status: ConnectionStatus.CONFIRMED,
      conversationId: clientData.conversationId,
      timestamp: new Date().toISOString()
    });

    logger.info('New client connected', {
      clientId: clientData.id,
      conversationId: clientData.conversationId,
      ip: clientIp,
      timestamp: new Date().toISOString()
    });

    return clientData;
  } catch (error) {
    logger.error('Error handling initial connection', {
      error: error.message,
      clientIp,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    if (ws.readyState === ConnectionState.OPEN) {
      ws.close(1011, 'Internal server error');
    }
    return null;
  }
}

/**
 * Set up connection timeout
 * @param {WebSocket} ws WebSocket connection
 * @returns {NodeJS.Timeout} Timeout handle
 */
export function setupConnectionTimeout(ws) {
  return setTimeout(() => {
    if (!connectionManager.getConnectionInfo(ws)) {
      logger.warn('Client failed to send connect message', {
        timestamp: new Date().toISOString()
      });
      ws.terminate();
    }
  }, CONNECTION_TIMEOUT);
}

/**
 * Handle client disconnection
 * @param {WebSocket} ws WebSocket connection
 */
export async function handleDisconnect(ws) {
  const client = connectionManager.getConnectionInfo(ws);
  if (client) {
    logger.info('Starting disconnect handling', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messageCount,
      timestamp: new Date().toISOString()
    });

    try {
      // Update client status
      client.status = ConnectionStatus.DISCONNECTED;

      // Calculate conversation duration
      const duration = Math.floor((Date.now() - client.connectedAt) / 1000);

      // Log the chat session
      await logChatSession(client, client.disconnectReason || 'normal_closure');

      // Save conversation state
      await messageStore.saveConversationState(client.id, {
        conversationId: client.conversationId,
        lastMessage: client.lastMessage,
        messageCount: client.messages.length
      });

      logger.info('Client disconnected', {
        clientId: client.id,
        conversationId: client.conversationId,
        messageCount: client.messageCount,
        imageCount: client.imageCount,
        duration,
        timestamp: new Date().toISOString()
      });

      // Clean up connection
      connectionManager.removeConnection(ws);

    } catch (error) {
      logger.error('Error handling disconnect:', {
        error: error.message,
        clientId: client.id,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }
}

/**
 * Handle explicit disconnect request
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} message Disconnect message
 */
export async function handleDisconnectRequest(ws, message) {
  const client = connectionManager.getConnectionInfo(ws);
  if (client && client.id === message.clientId) {
    try {
      // Acknowledge disconnect request
      await connectionManager.sendMessage(ws, {
        type: MessageType.CONFIRM,
        clientId: client.id,
        messageId: message.messageId,
        status: 'received',
        timestamp: new Date().toISOString()
      });

      // Close connection gracefully
      ws.close(1000, 'Client requested disconnect');
    } catch (error) {
      logger.error('Error handling disconnect request:', {
        error: error.message,
        clientId: client.id,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      ws.close(1011, 'Internal server error');
    }
  }
}