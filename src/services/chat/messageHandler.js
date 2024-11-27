import { logger } from '../../utils/logger.js';
import { MessageType, ImageProcessingStatus } from './connection/types.js';
import { v4 as uuidv4 } from 'uuid';
import { connectionManager } from './connection/manager.js';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic'
];

export function createMessage(type, clientId, data = {}) {
  return {
    type,
    clientId,
    timestamp: new Date().toISOString(),
    ...data
  };
}

export async function sendMessage(ws, message) {
  try {
    const sent = await connectionManager.sendMessage(ws, message);
    if (!sent) {
      throw new Error('Failed to send message through connection manager');
    }
    return true;
  } catch (error) {
    logger.error('Failed to send message', {
      error: error.message,
      type: message.type,
      clientId: message.clientId,
      stack: error.stack
    });
    
    // Try to send error message back to client
    try {
      const errorMessage = createMessage(MessageType.ERROR, message.clientId, {
        error: 'Failed to send message',
        details: error.message,
        code: 'MESSAGE_SEND_FAILED'
      });
      await connectionManager.sendMessage(ws, errorMessage);
    } catch (e) {
      logger.error('Failed to send error message', {
        error: e.message,
        originalError: error.message
      });
    }

    return false;
  }
}

function validateImage(imageData) {
  if (!imageData.data || !imageData.mimeType || !imageData.id) {
    return { valid: false, error: 'Missing required image data' };
  }

  if (!SUPPORTED_MIME_TYPES.includes(imageData.mimeType)) {
    return { valid: false, error: 'Unsupported image type' };
  }

  const decoded = Buffer.from(imageData.data, 'base64');
  if (decoded.length > MAX_IMAGE_SIZE) {
    return { valid: false, error: 'Image too large' };
  }

  return { valid: true };
}

async function handleImageMessage(ws, message, client) {
  if (!message.images || !Array.isArray(message.images)) {
    return null;
  }

  const validImages = [];
  const errors = [];

  // Validate each image
  for (const image of message.images) {
    const validation = validateImage(image);
    if (validation.valid) {
      validImages.push(image);
      
      // Send received confirmation
      await sendMessage(ws, createMessage(MessageType.CONFIRM, client.id, {
        messageId: message.messageId,
        imageId: image.id,
        status: ImageProcessingStatus.RECEIVED
      }));
    } else {
      errors.push({ imageId: image.id, error: validation.error });
    }
  }

  // Send errors if any
  if (errors.length > 0) {
    await sendMessage(ws, createMessage(MessageType.ERROR, client.id, {
      messageId: uuidv4(),
      errors,
      code: 'IMAGE_VALIDATION_ERROR'
    }));
  }

  return validImages;
}

export function handleIncomingMessage(ws, data, client) {
  try {
    const message = JSON.parse(data);

    // Validate message format
    if (!message.type || !message.clientId) {
      throw new Error('Invalid message format');
    }

    // Handle message confirmations
    if (message.type === MessageType.CONFIRM) {
      connectionManager.confirmMessageDelivery(ws, message.messageId);
      return null;
    }

    // Add messageId if not present
    if (!message.messageId) {
      message.messageId = uuidv4();
    }

    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    // Handle images if present
    if (message.images) {
      handleImageMessage(ws, message, client);
    }

    // Update connection activity
    connectionManager.updateActivity(ws);

    logger.debug('Message received', {
      type: message.type,
      clientId: message.clientId,
      messageId: message.messageId,
      hasImages: !!message.images?.length,
      timestamp: message.timestamp
    });

    // Send confirmation back to client
    const confirmation = createMessage(MessageType.CONFIRM, client.id, {
      messageId: message.messageId
    });
    connectionManager.sendMessage(ws, confirmation);

    return message;
  } catch (error) {
    logger.error('Error processing incoming message', {
      error: error.message,
      clientId: client?.id,
      data: typeof data === 'string' ? data : 'Invalid data',
      stack: error.stack
    });

    const errorMessage = createMessage(MessageType.ERROR, client?.id, {
      error: 'Invalid message format',
      details: error.message,
      code: 'MESSAGE_PARSE_ERROR'
    });

    connectionManager.sendMessage(ws, errorMessage);
    return null;
  }
}