import { WebSocket } from 'ws';

/**
 * @typedef {Object} ClientData
 * @property {string} id - Unique client identifier
 * @property {string} ip - Client IP address
 * @property {boolean} isAlive - Connection health status
 * @property {number} lastMessage - Timestamp of last message
 * @property {number} messageCount - Total messages sent
 * @property {string} conversationId - Current conversation ID
 * @property {Set<string>} pendingConfirmations - Set of pending message IDs
 * @property {number} lastActivity - Last activity timestamp
 */

/**
 * @typedef {Object} ImageData
 * @property {string} id - Unique image identifier
 * @property {string} data - Base64 encoded image data
 * @property {string} mimeType - Image MIME type
 * @property {string} [filename] - Original filename
 */

/**
 * @typedef {Object} ImageAnalysis
 * @property {string} imageId - Image identifier
 * @property {string} description - Detailed description
 * @property {string} category - Object category
 * @property {string} condition - Conservation state
 * @property {string[]} features - Notable features
 * @property {string[]} recommendations - Appraisal recommendations
 */

/**
 * @typedef {Object} Message
 * @property {string} type - Message type (message, response, error, etc)
 * @property {string} clientId - Client identifier
 * @property {string} messageId - Unique message identifier
 * @property {string} [content] - Message content
 * @property {ImageData[]} [images] - Array of image data
 * @property {string} timestamp - ISO timestamp
 */

/**
 * @typedef {Object} ImageConfirmation
 * @property {string} type - Always 'confirm'
 * @property {string} messageId - Original message ID
 * @property {string} imageId - Image identifier
 * @property {'received'|'processing'|'analyzed'} status - Processing status
 * @property {string} timestamp - ISO timestamp
 */

/**
 * @typedef {Object} ImageResponse
 * @property {string} type - Always 'response'
 * @property {string} messageId - Response message ID
 * @property {string} replyTo - Original message ID
 * @property {string} content - Text response
 * @property {ImageAnalysis[]} imageAnalysis - Array of image analyses
 * @property {string} timestamp - ISO timestamp
 */

export const ConnectionState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

export const MessageType = {
  CONNECT: 'connect',
  MESSAGE: 'message',
  RESPONSE: 'response',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  CONFIRM: 'confirm'
};

export const ImageProcessingStatus = {
  RECEIVED: 'received',
  PROCESSING: 'processing',
  ANALYZED: 'analyzed',
  FAILED: 'failed'
};