import { MessageType } from '../connection/types.js';

const REQUIRED_FIELDS = {
  [MessageType.MESSAGE]: ['type', 'content', 'messageId', 'clientId', 'timestamp'], 
  [MessageType.CONNECT]: ['type', 'clientId', 'timestamp'],
  [MessageType.CONNECT_CONFIRM]: ['type', 'clientId', 'conversationId', 'timestamp'],
  [MessageType.CONFIRM]: ['type', 'messageId', 'clientId', 'timestamp'],
  [MessageType.PING]: ['type', 'clientId', 'timestamp'],
  [MessageType.DISCONNECT]: ['type', 'clientId', 'timestamp', 'messageId']
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

  // Check required fields for message type
  const requiredFields = REQUIRED_FIELDS[message.type] || [];
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

  return {
    isValid: errors.length === 0,
    errors
  };
}