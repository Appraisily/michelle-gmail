import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';
import { handleMessage } from './handlers.js';
import { setupHeartbeat, handlePong } from './heartbeat.js';
import { connectionManager } from './connection/manager.js';
import { ConnectionState } from './connection/types.js';
import { 
  handleInitialConnection, 
  setupConnectionTimeout, 
  handleDisconnect 
} from './connection/connectionHandler.js';

export function initializeChatService(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    let clientData = null;

    // Set up initial connection timeout
    const connectionTimeout = setupConnectionTimeout(ws);

    // Handle initial connection message
    ws.once('message', async (data) => {
      try {
        const message = JSON.parse(data);
        clientData = await handleInitialConnection(ws, message, clientIp);

        if (clientData) {
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
                stack: error.stack,
                timestamp: new Date().toISOString()
              });
            }
          });
        }
      } catch (error) {
        logger.error('Invalid connection attempt', {
          error: error.message,
          ip: clientIp,
          data: data.toString(),
          timestamp: new Date().toISOString()
        });
        ws.terminate();
      } finally {
        clearTimeout(connectionTimeout);
      }
    });

    // Handle client disconnect
    ws.on('close', () => handleDisconnect(ws));

    // Handle heartbeat
    ws.on('pong', () => {
      if (clientData && ws.readyState === ConnectionState.OPEN) {
        handlePong(ws, clientData);
        connectionManager.updateActivity(ws);
      }
    });
  });

  // Setup heartbeat interval
  const heartbeatInterval = setupHeartbeat(wss, connectionManager);

  // Clean up on service shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    
    // Close all client connections
    wss.clients.forEach(ws => {
      handleDisconnect(ws);
      ws.terminate();
    });
  });

  logger.info('Chat service initialized', {
    timestamp: new Date().toISOString()
  });
}