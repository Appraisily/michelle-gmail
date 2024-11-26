import { WebSocketServer } from 'ws';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { handleMessage, handleConnect, handleDisconnect } from './handlers.js';
import { setupHeartbeat, HEARTBEAT_INTERVAL } from './heartbeat.js';

const clients = new Map();

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

        // Initialize client data
        clientData = handleConnect(ws, message.clientId, clientIp);
        clients.set(ws, clientData);

        // Set up message handler after successful connection
        ws.on('message', async (data) => {
          try {
            await handleMessage(ws, data, clientData);
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
      handleDisconnect(clientData);
      clients.delete(ws);
    });

    // Handle heartbeat
    ws.on('pong', () => {
      if (clientData) {
        clientData.isAlive = true;
      }
    });

    // Set connection timeout if no connect message received
    const connectionTimeout = setTimeout(() => {
      if (!clientData) {
        logger.warn('Client failed to send connect message', { ip: clientIp });
        ws.terminate();
      }
    }, 5000); // 5 second timeout

    // Clear timeout on first message or close
    ws.once('message', () => clearTimeout(connectionTimeout));
    ws.once('close', () => clearTimeout(connectionTimeout));
  });

  // Setup heartbeat interval
  const heartbeatInterval = setupHeartbeat(wss, clients);

  // Clean up on service shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    
    // Close all client connections
    wss.clients.forEach(ws => {
      const client = clients.get(ws);
      if (client) {
        handleDisconnect(client);
      }
      ws.terminate();
    });
    
    clients.clear();
  });

  logger.info('Chat service initialized', {
    heartbeatInterval: HEARTBEAT_INTERVAL,
    timestamp: new Date().toISOString()
  });
}