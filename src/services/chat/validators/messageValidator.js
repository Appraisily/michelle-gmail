import { MessageType } from '../connection/types.js';

const REQUIRED_FIELDS = {
  // System messages don't require messageId
  [MessageType.CONNECT]: ['type', 'clientId', 'timestamp'],
  [MessageType.CONNECT_CONFIRM]: ['type', 'clientId', 'conversationId', 'timestamp'],
  [MessageType.PING]: ['type', 'clientId', 'timestamp'],
  [MessageType.PONG]: ['type', 'clientId', 'timestamp'],
  [MessageType.DISCONNECT]: ['type', 'clientId', 'timestamp'],
  // Regular messages require messageId
  [MessageType.MESSAGE]: ['type', 'messageId', 'clientId', 'timestamp'],
  [MessageType.CONFIRM]: ['type', 'messageId', 'clientId', 'timestamp'],
  [MessageType.ERROR]: ['type', 'clientId', 'timestamp']
};

export function validateMessage(message) {
  const errors = [];

  // Check if message is an object
  if (!message || typeof message !== 'object') {
    return {
      isValid: false,
      errors: ['Message must be an object']
    };
  }

  // Check message type
  if (!message.type || !Object.values(MessageType).includes(message.type)) {
    errors.push('Invalid or missing message type');
    return {
      isValid: false,
      errors
    };
  }

  // Get required fields based on message type
  const requiredFields = REQUIRED_FIELDS[message.type];
  
  // If message type not found in REQUIRED_FIELDS, only require basic fields
  if (!requiredFields) {
    return {
      isValid: !!(message.type && message.clientId && message.timestamp),
      errors: []
    };
  }

  // Validate required fields
  for (const field of requiredFields) {
    if (!message[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate timestamp format
  if (message.timestamp) {
    try {
      new Date(message.timestamp);
    } catch (e) {
      errors.push('Invalid timestamp format');
    }
  }

  // Special validation for MESSAGE type
  if (message.type === MessageType.MESSAGE) {
    // Allow messages with either content or images or both
    if (!message.content && (!message.images || !Array.isArray(message.images) || message.images.length === 0)) {
      errors.push('Message must contain either text content or images');
    }

    // Validate images if present
    if (message.images) {
      if (!Array.isArray(message.images)) {
        errors.push('Images must be an array');
      } else {
        message.images.forEach((img, index) => {
          if (!img.data || !img.mimeType) {
            errors.push(`Invalid image data at index ${index}`);
          }
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
