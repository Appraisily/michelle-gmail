// WebSocket connection states
export const ConnectionState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

export const MessageType = {
  CONNECT: 'connect',
  CONNECT_CONFIRM: 'connect_confirm',
  MESSAGE: 'message',
  RESPONSE: 'response',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  CONFIRM: 'confirm',
  IMAGE_STATUS: 'image_status'
};

export const ConnectionStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed'
};

export const ImageProcessingStatus = {
  RECEIVED: 'received',
  PROCESSING: 'processing',
  ANALYZED: 'analyzed',
  FAILED: 'failed'
};

export const MessageDeliveryStatus = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  RETRYING: 'retrying'
};

/**
 * @typedef {Object} ClientData
 * @property {string} id Client identifier
 * @property {string} ip Client IP address
 * @property {boolean} isAlive Connection alive status
 * @property {number} lastMessage Timestamp of last message
 * @property {number} messageCount Total messages sent
 * @property {string} conversationId Current conversation ID
 * @property {ConnectionStatus} connectionStatus Connection status
 * @property {Set<string>} pendingConfirmations Set of pending message IDs
 * @property {number} lastActivity Last activity timestamp
 */

/**
 * @typedef {Object} Message
 * @property {MessageType} type Message type
 * @property {string} clientId Client identifier
 * @property {string} messageId Message identifier
 * @property {string} [content] Message content
 * @property {Array<ImageData>} [images] Image attachments
 * @property {string} timestamp ISO timestamp
 * @property {string} [conversationId] Conversation identifier
 * @property {string} [replyTo] Original message ID being replied to
 * @property {ImageAnalysis[]} [imageAnalysis] Image analysis results
 */

/**
 * @typedef {Object} ImageData
 * @property {string} id Image identifier
 * @property {string} data Base64 encoded image data
 * @property {string} mimeType Image MIME type
 * @property {string} [filename] Original filename
 * @property {ImageProcessingStatus} status Processing status
 */

/**
 * @typedef {Object} ImageAnalysis
 * @property {string} imageId Image identifier
 * @property {string} description Detailed description
 * @property {string} category Item category
 * @property {string} condition Item condition
 * @property {string[]} features Notable features
 * @property {string[]} recommendations Professional recommendations
 */

/**
 * @typedef {Object} MessageConfirmation
 * @property {string} messageId Message identifier
 * @property {MessageDeliveryStatus} status Delivery status
 * @property {string} [error] Error message if failed
 * @property {number} timestamp Confirmation timestamp
 */

/**
 * @typedef {Object} ImageStatusUpdate
 * @property {string} imageId Image identifier
 * @property {ImageProcessingStatus} status Processing status
 * @property {string} [error] Error message if failed
 * @property {ImageAnalysis} [analysis] Analysis results if completed
 */