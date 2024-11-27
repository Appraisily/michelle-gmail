import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { processChat } from './processor.js';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, ImageProcessingStatus } from './connection/types.js';
import { connectionManager } from './connection/manager.js';
import { createMessage, sendMessage, handleIncomingMessage } from './messageHandler.js';

export const RATE_LIMIT_WINDOW = 1000; // 1 second between messages

export async function handleMessage(ws, data, client) {
  const message = handleIncomingMessage(ws, data, client);
  if (!message) return;

  try {
    // Handle ping messages directly
    if (message.type === MessageType.PING) {
      return sendMessage(ws, createMessage(MessageType.PONG, client.id));
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
      hasContent: !!message.content,
      hasImages: !!message.images?.length
    });

    // Send processing status for images
    if (message.images?.length > 0) {
      for (const image of message.images) {
        await sendMessage(ws, createMessage(MessageType.CONFIRM, client.id, {
          messageId: message.messageId,
          imageId: image.id,
          status: ImageProcessingStatus.PROCESSING
        }));
      }
    }

    const response = await processChat({
      ...message,
      id: message.messageId || uuidv4(),
      conversationId: client.conversationId
    }, client.id);

    // Send analyzed status for images
    if (message.images?.length > 0 && response?.imageAnalysis) {
      for (const analysis of response.imageAnalysis) {
        await sendMessage(ws, createMessage(MessageType.CONFIRM, client.id, {
          messageId: message.messageId,
          imageId: analysis.imageId,
          status: ImageProcessingStatus.ANALYZED
        }));
      }
    }

    return sendMessage(ws, createMessage(MessageType.RESPONSE, client.id, {
      messageId: response.messageId,
      content: response.content,
      conversationId: client.conversationId,
      replyTo: message.messageId,
      imageAnalysis: response.imageAnalysis
    }));

  } catch (error) {
    logger.error('Error processing chat message', {
      error: error.message,
      clientId: client?.id,
      stack: error.stack
    });

    // Send failed status for images
    if (message.images?.length > 0) {
      for (const image of message.images) {
        await sendMessage(ws, createMessage(MessageType.CONFIRM, client.id, {
          messageId: message.messageId,
          imageId: image.id,
          status: ImageProcessingStatus.FAILED
        }));
      }
    }

    sendMessage(ws, createMessage(MessageType.ERROR, client.id, {
      error: 'Failed to process message',
      details: error.message,
      code: 'PROCESSING_ERROR'
    }));
  }
}

export function handleConnect(ws, clientId, clientIp) {
  // Wait for connection to be fully established
  setTimeout(() => {
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

    // Add connection first
    connectionManager.addConnection(ws, clientData);

    // Then send welcome message
    sendMessage(ws, createMessage(MessageType.RESPONSE, clientId, {
      messageId: uuidv4(),
      conversationId: clientData.conversationId,
      content: 'Welcome! I\'m Michelle from Appraisily. How can I assist you with your art and antique appraisal needs today?'
    }));
    
    return clientData;
  }, 100); // Small delay to ensure connection is ready
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