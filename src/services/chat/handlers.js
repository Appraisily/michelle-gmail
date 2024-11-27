import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { processChat } from './processor.js';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, ConnectionState, ConnectionStatus } from './connection/types.js';
import { connectionManager } from './connection/manager.js';
import { createMessage, sendMessage, handleIncomingMessage } from './messageHandler.js';

export const RATE_LIMIT_WINDOW = 1000; // 1 second between messages

export async function handleMessage(ws, data, client) {
  // Verify connection is still open
  if (ws.readyState !== ConnectionState.OPEN) {
    logger.warn('Attempted to handle message on non-open connection', {
      clientId: client?.id,
      readyState: ws.readyState
    });
    return;
  }

  const message = handleIncomingMessage(ws, data, client);
  if (!message) return;

  try {
    // Handle ping messages directly
    if (message.type === MessageType.PING) {
      return sendMessage(ws, createMessage(MessageType.PONG, client.id));
    }
    
    // Handle connection confirmation
    if (message.type === MessageType.CONNECT_CONFIRM) {
      client.connectionStatus = ConnectionStatus.CONFIRMED;
      // Now send welcome message
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
        messageType: message.type
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

    logger.info('Processing chat message', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageType: message.type,
      hasContent: !!message.content
    });

    const response = await processChat({
      ...message,
      id: message.messageId || uuidv4(),
      conversationId: client.conversationId
    }, client.id);

    return sendMessage(ws, createMessage(MessageType.RESPONSE, client.id, {
      messageId: response.messageId,
      content: response.content,
      conversationId: client.conversationId,
      replyTo: message.messageId
    }));

  } catch (error) {
    logger.error('Error processing chat message', {
      error: error.message,
      clientId: client?.id,
      stack: error.stack
    });

    sendMessage(ws, createMessage(MessageType.ERROR, client.id, {
      error: 'Failed to process message',
      details: error.message,
      code: 'PROCESSING_ERROR'
    }));
  }
}

export function handleConnect(ws, clientId, clientIp) {
  // Create client data first
  const clientData = {
    id: clientId,
    ip: clientIp,
    isAlive: true,
    lastMessage: Date.now(),
    messageCount: 0,
    conversationId: uuidv4(),
    connectionStatus: ConnectionStatus.PENDING
  };

  // Add to connection manager before any async operations
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
    sendMessage(ws, createMessage(MessageType.CONNECT_CONFIRM, clientId, {
      messageId: uuidv4(),
      conversationId: clientData.conversationId,
      status: ConnectionStatus.PENDING
    }));
  }
  
  return clientData;
}

export function handleDisconnect(client) {
  if (client) {
    logger.info('Chat client disconnected', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messageCount,
      duration: Date.now() - client.lastMessage,
      timestamp: new Date().toISOString()
    });
    
    recordMetric('chat_disconnections', 1);
  }
}