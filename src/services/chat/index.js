import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classifyAndProcessChat } from './processor.js';

const HEARTBEAT_INTERVAL = 30000;
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
      lastMessage: Date.now()
    });

    logger.info('New chat client connected', { clientId, ip: clientIp });
    recordMetric('chat_connections', 1);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connection_established',
      clientId,
      timestamp: new Date().toISOString()
    }));

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const client = clients.get(ws);

        // Log the received message with detailed structure
        logger.info('Received chat message', {
          clientId: client.id,
          messageType: message.type,
          content: message.content,
          context: message.context,
          images: message.images?.length || 0,
          email: message.email,
          timestamp: new Date().toISOString()
        });

        // Handle ping messages immediately without processing
        if (message.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            clientId: client.id,
            timestamp: new Date().toISOString()
          }));
          return;
        }

        // Rate limiting check
        const now = Date.now();
        if (now - client.lastMessage < 1000) { // 1 second cooldown
          logger.warn('Rate limit exceeded', {
            clientId: client.id,
            timeSinceLastMessage: now - client.lastMessage
          });
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Rate limit exceeded',
            timestamp: new Date().toISOString()
          }));
          return;
        }
        client.lastMessage = now;

        // Process non-ping messages
        if (message.type === 'message') {
          // Log the data being sent to OpenAI
          logger.info('Sending to OpenAI for processing', {
            clientId: client.id,
            content: message.content,
            context: message.context ? [{
              content: message.context,
              isIncoming: true
            }] : null,
            images: message.images?.map(img => ({
              type: img.type,
              hasData: !!img.data
            })) || null,
            email: message.email || 'chat-user',
            timestamp: new Date().toISOString()
          });

          const response = await classifyAndProcessChat(message, client.id);
          
          // Log the OpenAI response
          logger.info('Received OpenAI response', {
            clientId: client.id,
            response,
            timestamp: new Date().toISOString()
          });

          ws.send(JSON.stringify({
            type: 'response',
            ...response,
            timestamp: new Date().toISOString()
          }));
          recordMetric('chat_messages_processed', 1);
        }
      } catch (error) {
        logger.error('Error processing chat message:', {
          error: error.message,
          stack: error.stack,
          clientId: clients.get(ws)?.id,
          rawData: data.toString()
        });
        recordMetric('chat_processing_errors', 1);
        
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Failed to process message',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      const client = clients.get(ws);
      clients.delete(ws);
      logger.info('Chat client disconnected', { 
        clientId: client?.id,
        connectedDuration: Date.now() - client?.lastMessage
      });
      recordMetric('chat_disconnections', 1);
    });

    // Handle heartbeat
    ws.on('pong', () => {
      const client = clients.get(ws);
      if (client) {
        client.isAlive = true;
      }
    });
  });

  // Heartbeat to keep connections alive
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = clients.get(ws);
      if (client === undefined) return;

      if (client.isAlive === false) {
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