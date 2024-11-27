import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { processChat } from './processor.js';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, ConnectionState, ConnectionStatus } from './connection/types.js';
import { connectionManager } from './connection/manager.js';
import { reconnectionManager } from './connection/reconnect.js';
import { createMessage, sendMessage } from './messageHandler.js';

export const RATE_LIMIT_WINDOW = 1000; // 1 second between messages

export async function handleMessage(ws, data, client) {
  try {
    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Attempted to handle message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const message = JSON.parse(data);

    // Validate message format
    if (!message.type || !message.clientId) {
      throw new Error('Invalid message format');
    }

    // Handle connection confirmation
    if (message.type === MessageType.CONFIRM && client.connectionStatus === ConnectionStatus.PENDING) {
      client.connectionStatus = ConnectionStatus.CONFIRMED;
      // Reset reconnection state on successful connection
      reconnectionManager.resetState(client.id);
      
      logger.info('Connection confirmed', {
        clientId: client.id,
        timestamp: new Date().toISOString()
      });
      
      // Send welcome message after confirmation
      return sendMessage(ws, createMessage(MessageType.RESPONSE, client.id, {
        messageId: uuidv4(),
        conversationId: client.conversationId,
        content: 'Welcome! I\'m Michelle from Appraisily. How can I assist you with your art and antique appraisal needs today?'
      }));
    }

    // Only process regular messages if connection is confirmed
    if (client.connectionStatus !== ConnectionStatus.CONFIRMED) {
      logger.warn('Message received before connection confirmation', {
        clientId: client.id,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - client.lastMessage < RATE_LIMIT_WINDOW) {
      return sendMessage(ws, createMessage(MessageType.ERROR, client.id, {
        error: 'Please wait a moment before sending another message',
        code: 'RATE_LIMIT'
      }));
    }

    // Update client state
    client.lastMessage = now;
    client.messageCount++;

    // Process message
    if (message.type === MessageType.MESSAGE) {
      logger.info('Processing chat message', {
        clientId: client.id,
        conversationId: client.conversationId,
        hasContent: !!message.content,
        messageType: message.type,
        timestamp: new Date().toISOString()
      });

      // Send confirmation
      await sendMessage(ws, createMessage(MessageType.CONFIRM, client.id, {
        messageId: message.messageId
      }));

      // Process chat message
      const response = await processChat(message, client.id);
      if (response) {
        await sendMessage(ws, createMessage(MessageType.RESPONSE, client.id, {
          messageId: response.messageId,
          content: response.content,
          replyTo: message.messageId
        }));
      }
    }

  } catch (error) {
    logger.error('Error handling message:', {
      error: error.message,
      clientId: client?.id,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    if (ws.readyState === ConnectionState.OPEN) {
      sendMessage(ws, createMessage(MessageType.ERROR, client?.id, {
        error: 'Failed to process message',
        code: 'PROCESSING_ERROR'
      }));
    }
  }
}

export function handleConnect(ws, clientId, clientIp) {
  // Check reconnection status
  const reconnectStatus = reconnectionManager.canReconnect(clientId);
  
  if (!reconnectStatus.allowed) {
    if (reconnectStatus.reason === 'TOO_SOON') {
      logger.warn('Rejecting connection attempt - too soon', {
        clientId,
        waitTime: reconnectStatus.waitTime,
        timestamp: new Date().toISOString()
      });
      ws.close(1013, `Wait ${reconnectStatus.waitTime}ms before reconnecting`);
      return null;
    }
    
    if (reconnectStatus.reason === 'MAX_RETRIES_EXCEEDED') {
      logger.warn('Rejecting connection attempt - max retries exceeded', {
        clientId,
        timestamp: new Date().toISOString()
      });
      ws.close(1013, 'Maximum reconnection attempts exceeded');
      return null;
    }
  }

  // Record reconnection attempt
  reconnectionManager.recordAttempt(clientId);

  // Create client data
  const clientData = {
    id: clientId,
    ip: clientIp,
    isAlive: true,
    lastMessage: Date.now(),
    messageCount: 0,
    conversationId: uuidv4(),
    connectionStatus: ConnectionStatus.PENDING
  };

  // Add to connection manager
  connectionManager.addConnection(ws, clientData);

  logger.info('Chat client connected', { 
    clientId: clientData.id,
    conversationId: clientData.conversationId,
    ip: clientIp,
    timestamp: new Date().toISOString()
  });
  
  recordMetric('chat_connections', 1);

  // Send connection confirmation request
  if (ws.readyState === ConnectionState.OPEN) {
    sendMessage(ws, createMessage(MessageType.CONNECT_CONFIRM, clientId));
  }
  
  return clientData;
}

export function handleDisconnect(client) {
  if (client) {
    logger.info('Chat client disconnected', {
      clientId: client.id,
      conversationId: client.conversationId,
      duration: Date.now() - client.lastMessage,
      messageCount: client.messageCount,
      timestamp: new Date().toISOString()
    });
    
    recordMetric('chat_disconnections', 1);
  }
}