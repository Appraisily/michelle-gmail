import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { processChat } from './processor.js';
import { v4 as uuidv4 } from 'uuid';

export const RATE_LIMIT_WINDOW = 1000; // 1 second between messages

export async function handleMessage(ws, data, client) {
  try {
    const message = JSON.parse(data);
    
    // Rate limiting check
    const now = Date.now();
    if (now - client.lastMessage < RATE_LIMIT_WINDOW) {
      sendError(ws, client, 'Please wait a moment before sending another message');
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

    const response = await processChat({
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

  sendWelcomeMessage(ws, clientData);
  
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

function sendWelcomeMessage(ws, client) {
  const welcomeMessage = {
    type: 'connection_established',
    clientId: client.id,
    conversationId: client.conversationId,
    messageId: uuidv4(),
    content: 'Welcome! I\'m Michelle from Appraisily. How can I assist you with your art and antique appraisal needs today?',
    timestamp: new Date().toISOString()
  };

  ws.send(JSON.stringify(welcomeMessage));
}

function sendResponse(ws, client, response) {
  // Ensure response has all required fields
  const formattedResponse = {
    type: response.type,
    clientId: client.id,
    conversationId: client.conversationId,
    messageId: response.messageId,
    replyTo: response.replyTo,
    content: response.content || response.message,
    timestamp: response.timestamp || new Date().toISOString()
  };

  ws.send(JSON.stringify(formattedResponse));

  logger.debug('Sent response', {
    clientId: client.id,
    conversationId: client.conversationId,
    messageId: formattedResponse.messageId,
    replyTo: formattedResponse.replyTo,
    type: formattedResponse.type
  });
}

function sendError(ws, client, message, details = null) {
  const errorResponse = {
    type: 'error',
    clientId: client?.id,
    conversationId: client?.conversationId,
    messageId: uuidv4(),
    content: message,
    details: process.env.NODE_ENV === 'development' ? details : undefined,
    timestamp: new Date().toISOString()
  };

  ws.send(JSON.stringify(errorResponse));
}

function handleError(ws, client, error) {
  logger.error('Error processing chat message', {
    error: error.message,
    clientId: client?.id,
    conversationId: client?.conversationId,
    stack: error.stack
  });

  sendError(
    ws, 
    client,
    'I apologize, but I\'m having trouble processing your message. Could you please try again?',
    error.message
  );
}