import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classifyAndProcessChat } from './processor.js';

const HEARTBEAT_INTERVAL = 30000;
const RATE_LIMIT_WINDOW = 1000; // 1 second between messages
const clients = new Map();

export function initializeChatService(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const clientIp = req.socket.remoteAddress;

    // Store client info
    clients.set(ws, {
      id: clientId,
      ip: clientIp,
      isAlive: true,
      lastMessage: Date.now(),
      messageCount: 0
    });

    logger.info('New chat client connected', { 
      clientId, 
      ip: clientIp,
      timestamp: new Date().toISOString()
    });
    
    recordMetric('chat_connections', 1);

    // Send welcome message
    const welcomeMessage = {
      type: 'connection_established',
      clientId,
      message: 'Welcome! I\'m Michelle from Appraisily. How can I assist you with your art and antique appraisal needs today?',
      timestamp: new Date().toISOString()
    };

    ws.send(JSON.stringify(welcomeMessage));

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const client = clients.get(ws);

        // Rate limiting check
        const now = Date.now();
        if (now - client.lastMessage < RATE_LIMIT_WINDOW) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Please wait a moment before sending another message',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        // Update client state
        client.lastMessage = now;
        client.messageCount++;

        logger.info('Received chat message', {
          clientId: client.id,
          messageType: message.type,
          timestamp: new Date().toISOString()
        });

        // Process message
        try {
          const response = await classifyAndProcessChat({
            ...message,
            id: uuidv4()
          }, client.id);

          // Handle different response types
          if (response.type === 'pong') {
            ws.send(JSON.stringify({
              type: 'pong',
              clientId: client.id,
              timestamp: new Date().toISOString()
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'response',
              clientId: client.id,
              messageId: response.messageId,
              message: response.reply,
              timestamp: response.timestamp
            }));
          }

        } catch (error) {
          logger.error('Error processing chat message', {
            error: error.message,
            clientId: client.id,
            stack: error.stack
          });

          ws.send(JSON.stringify({
            type: 'error',
            error: 'I apologize, but I\'m having trouble processing your message. Could you please try again?',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
          }));
        }

      } catch (error) {
        logger.error('Error parsing message data', {
          error: error.message,
          data: data.toString(),
          stack: error.stack
        });

        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      const client = clients.get(ws);
      if (client) {
        logger.info('Chat client disconnected', {
          clientId: client.id,
          messageCount: client.messageCount,
          duration: Date.now() - client.lastMessage,
          timestamp: new Date().toISOString()
        });
        
        clients.delete(ws);
        recordMetric('chat_disconnections', 1);
      }
    });

    // Handle heartbeat
    ws.on('pong', () => {
      const client = clients.get(ws);
      if (client) {
        client.isAlive = true;
      }
    });
  });

  // Heartbeat interval to keep connections alive
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = clients.get(ws);
      if (!client) {
        return ws.terminate();
      }

      if (client.isAlive === false) {
        logger.info('Terminating inactive client', {
          clientId: client.id,
          lastMessage: new Date(client.lastMessage).toISOString()
        });
        clients.delete(ws);
        return ws.terminate();
      }

      client.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(interval);
  });

  logger.info('Chat service initialized');
}