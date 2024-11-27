import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';
import { handleMessage, handleConnect, handleDisconnect } from './handlers.js';
import { setupHeartbeat, handlePong, HEARTBEAT_INTERVAL } from './heartbeat.js';
import { connectionManager } from './connection/manager.js';
import { ConnectionState } from './connection/types.js';

const CONNECTION_TIMEOUT = 5000; // 5 seconds
const RECONNECT_WINDOW = 3000; // 3 seconds

// Track recent connections to prevent duplicates
const recentConnections = new Map();

export function initializeChatService(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    let clientData = null;

    // Handle initial connection message
    ws.once('message', async (data) => {
      try {
        const message = JSON.parse(data);
        
        if (message.type !== 'connect' || !message.clientId) {
          throw new Error('Invalid connection message');
        }

        // Check for recent connections from this client
        const recentConnection = recentConnections.get(message.clientId);
        if (recentConnection) {
          const timeSinceLastConnect = Date.now() - recentConnection.timestamp;
          if (timeSinceLastConnect < RECONNECT_WINDOW) {
            logger.warn('Rejecting duplicate connection attempt', {
              clientId: message.clientId,
              timeSinceLastConnect,
              ip: clientIp
            });
            ws.close(1008, 'Duplicate connection');
            return;
          }
        }

        // Clean up any existing connection for this client
        const existingConnection = connectionManager.getConnectionInfo(ws);
        if (existingConnection) {
          logger.info('Cleaning up existing connection', {
            clientId: message.clientId,
            previousConversationId: existingConnection.conversationId
          });
          handleDisconnect(existingConnection);
          connectionManager.removeConnection(ws);
        }

        // Initialize client data and send welcome message
        clientData = handleConnect(ws, message.clientId, clientIp);

        // Track this connection
        recentConnections.set(message.clientId, {
          timestamp: Date.now(),
          conversationId: clientData.conversationId
        });

        // Clean up old connection tracking
        const now = Date.now();
        for (const [id, data] of recentConnections.entries()) {
          if (now - data.timestamp > RECONNECT_WINDOW) {
            recentConnections.delete(id);
          }
        }

        // Set up message handler after successful connection
        ws.on('message', async (data) => {
          try {
            if (ws.readyState === ConnectionState.OPEN) {
              await handleMessage(ws, data, clientData);
            }
          } catch (error) {
            logger.error('Error handling message', {
              error: error.message,
              clientId: clientData?.id,
              stack: error.stack
            });
          }
        });

      } catch (error) {
        logger.error('Invalid connection attempt', {
          error: error.message,
          ip: clientIp,
          data: data.toString()
        });
        ws.terminate();
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      if (clientData) {
        handleDisconnect(clientData);
        connectionManager.removeConnection(ws);
      }
    });

    // Handle heartbeat
    ws.on('pong', () => {
      if (clientData && ws.readyState === ConnectionState.OPEN) {
        handlePong(ws, clientData);
        connectionManager.updateActivity(ws);
      }
    });

    // Set connection timeout if no connect message received
    const connectionTimeout = setTimeout(() => {
      if (!clientData) {
        logger.warn('Client failed to send connect message', { ip: clientIp });
        ws.terminate();
      }
    }, CONNECTION_TIMEOUT);

    // Clear timeout on first message or close
    ws.once('message', () => clearTimeout(connectionTimeout));
    ws.once('close', () => clearTimeout(connectionTimeout));
  });

  // Setup heartbeat interval
  const heartbeatInterval = setupHeartbeat(wss, connectionManager);

  // Clean up on service shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    
    // Close all client connections
    wss.clients.forEach(ws => {
      const client = connectionManager.getConnectionInfo(ws);
      if (client) {
        handleDisconnect(client);
      }
      ws.terminate();
    });
    
    recentConnections.clear();
  });

  logger.info('Chat service initialized', {
    heartbeatInterval: HEARTBEAT_INTERVAL,
    connectionTimeout: CONNECTION_TIMEOUT,
    reconnectWindow: RECONNECT_WINDOW,
    timestamp: new Date().toISOString()
  });
}