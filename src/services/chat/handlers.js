import { logger } from '../../utils/logger.js';
import { connectionManager } from './connection/manager.js';
import { MessageType, ConnectionState } from './connection/types.js';
import { processChat } from './processor.js';
import { validateMessage } from './validators/messageValidator.js';
import { validateAndPrepareImages } from './handlers/imageHandler.js';
import { handleDisconnectRequest } from './connection/connectionHandler.js';
import { 
  handleMessageError, 
  handleValidationError, 
  handleWebSocketError 
} from './errors/errorHandler.js';

// Typing speed simulation (characters per minute)
const TYPING_SPEED = 800;
const MIN_TYPING_TIME = 2000; // Minimum 2 seconds
const MAX_TYPING_TIME = 8000; // Maximum 8 seconds
const THINKING_TIME = 3000; // Time to "think" before typing
const MAX_CHUNK_LENGTH = 500; // Maximum length before splitting

/**
 * Calculate typing delay based on message length
 */
function calculateTypingDelay(message) {
  const charCount = message.length;
  const typingTime = (charCount / TYPING_SPEED) * 60 * 1000; // Convert to milliseconds
  return Math.min(Math.max(typingTime, MIN_TYPING_TIME), MAX_TYPING_TIME);
}

/**
 * Send typing indicator
 */
async function sendTypingIndicator(ws, client, isTyping) {
  await connectionManager.sendMessage(ws, {
    type: MessageType.STATUS,
    clientId: client.id,
    status: isTyping ? 'typing' : 'idle',
    timestamp: new Date().toISOString()
  });
}

/**
 * Split message into natural chunks if needed
 */
function splitMessage(message) {
  // Only split if message exceeds max length
  if (message.length <= MAX_CHUNK_LENGTH) {
    return [message];
  }

  // Find natural break points (sentences or paragraphs)
  const breakPoints = message.match(/[^.!?\n]+[.!?\n]+/g) || [message];
  
  // Combine into maximum 2 chunks
  const chunks = [];
  let currentChunk = '';
  
  for (const point of breakPoints) {
    // If adding this point would make first chunk too long, start second chunk
    if (currentChunk && (currentChunk + point).length > MAX_CHUNK_LENGTH) {
      chunks.push(currentChunk.trim());
      currentChunk = point;
      // Break if we already have 2 chunks
      if (chunks.length === 2) {
        break;
      }
    } else {
      currentChunk += point;
    }
  }
  
  // Add remaining text
  if (currentChunk && chunks.length < 2) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

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

    // Skip processing for system messages
    if (message.type === MessageType.PING || 
        message.type === MessageType.PONG || 
        message.type === MessageType.STATUS) {
      // Just confirm receipt for system messages
      await connectionManager.sendMessage(ws, {
        type: MessageType.CONFIRM,
        clientId: client.id,
        messageId: message.messageId,
        status: 'received',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Validate message format
    const validationResult = validateMessage(message);
    if (!validationResult.isValid) {
      await handleValidationError(ws, client, message.messageId, validationResult.errors);
      return;
    }

    // Handle disconnect request
    if (message.type === MessageType.DISCONNECT) {
      await handleDisconnectRequest(ws, message);
      return;
    }

    // Update client state
    client.lastMessage = Date.now();
    client.messageCount++;

    // Track message in client's conversation history
    if (message.content || message.images?.length > 0) {
      client.messages.push({
        type: 'user',
        content: message.content,
        hasImages: !!message.images?.length,
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Processing chat message', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageId: message.messageId,
      messageType: message.type,
      hasContent: !!message.content,
      hasImages: !!message.images?.length,
      timestamp: new Date().toISOString()
    });

    // Send delivery confirmation
    await connectionManager.sendMessage(ws, {
      type: MessageType.CONFIRM,
      clientId: client.id,
      messageId: message.messageId,
      status: 'received',
      timestamp: new Date().toISOString()
    });

    // Validate and prepare images if present
    if (message.images?.length > 0) {
      const imageValidation = validateAndPrepareImages(message.images);
      if (!imageValidation.isValid) {
        await handleValidationError(ws, client, message.messageId, imageValidation.errors);
        return;
      }
      message.images = imageValidation.images;
      client.imageCount += message.images.length;
      
      // Show "thinking" indicator for images
      await sendTypingIndicator(ws, client, false);
      await new Promise(resolve => setTimeout(resolve, THINKING_TIME));
    }

    // Show typing indicator
    await sendTypingIndicator(ws, client, true);

    // Process message
    const response = await processChat(message, client.id);
    
    // Track response in client's conversation history
    client.messages.push({
      type: 'assistant',
      content: response.content,
      timestamp: new Date().toISOString()
    });
    
    // Split response if needed
    const messageChunks = splitMessage(response.content);

    // Send each chunk with natural delays
    for (const [index, chunk] of messageChunks.entries()) {
      // Calculate typing time based on chunk length
      const typingTime = calculateTypingDelay(chunk);
      
      // Wait for "typing" time
      await new Promise(resolve => setTimeout(resolve, typingTime));

      // Send chunk
      await connectionManager.sendMessage(ws, {
        type: MessageType.RESPONSE,
        clientId: client.id,
        messageId: `${response.messageId}-${index}`,
        content: chunk,
        replyTo: message.messageId,
        timestamp: new Date().toISOString()
      });

      // If not last chunk, add small pause and show typing again
      if (index < messageChunks.length - 1) {
        await sendTypingIndicator(ws, client, false);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await sendTypingIndicator(ws, client, true);
      }
    }

    // Stop typing indicator
    await sendTypingIndicator(ws, client, false);

  } catch (error) {
    await handleMessageError(ws, error, client, message?.messageId);
  }
}