import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classifyAndProcessChat } from './processor.js';
import { v4 as uuidv4 } from 'uuid';

export const RATE_LIMIT_WINDOW = 1000; // 1 second between messages

export async function handleMessage(ws, data, client) {
  try {
    const message = JSON.parse(data);
    
    // Rate limiting check
    const now = Date.now();
    if (now - client.lastMessage < RATE_LIMIT_WINDOW) {
      ws.send(JSON.stringify({
        type: 'error',
        clientId: client.id,
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
      conversationId: client.conversationId,
      messageType: message.type,
      timestamp: new Date().toISOString()
    });

    const response = await classifyAndProcessChat({
      ...message,
      id: uuidv4(),
      conversationId: client.conversationId
    }, client.id);

    sendResponse(ws, client, response);

  } catch (error) {
    handleError(ws, client, error);
  }
}

export function handleConnect(ws, clientId, clientIp) {
  const clientData = {
    id: clientId,
    ip: clientIp,
    isAlive: true,
    lastMessage: Date.now(),
    messageCount: 0,
    conversationId: uuidv4()
  };

  logger.info('Chat client connected', { 
    clientId: clientData.id,
    conversationId: clientData.conversationId,
    ip: clientIp,
    timestamp: new Date().toISOString()
  });
  
  recordMetric('chat_connections', 1);

  const welcomeMessage = {
    type: 'connection_established',
    clientId: clientData.id,
    conversationId: clientData.conversationId,
    message: 'Welcome! I\'m Michelle from Appraisily. How can I assist you with your art and antique appraisal needs today?',
    timestamp: new Date().toISOString()
  };

  ws.send(JSON.stringify(welcomeMessage));
  
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

function sendResponse(ws, client, response) {
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
      conversationId: client.conversationId,
      messageId: response.messageId,
      message: response.reply,
      timestamp: response.timestamp
    }));
  }
}

function handleError(ws, client, error) {
  logger.error('Error processing chat message', {
    error: error.message,
    clientId: client?.id,
    stack: error.stack
  });

  ws.send(JSON.stringify({
    type: 'error',
    clientId: client?.id,
    error: 'I apologize, but I\'m having trouble processing your message. Could you please try again?',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    timestamp: new Date().toISOString()
  }));
}