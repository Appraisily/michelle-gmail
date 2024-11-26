// Message Types
export const MessageType = {
  CONNECT: 'connect',
  MESSAGE: 'message',
  RESPONSE: 'response',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  CONFIRM: 'confirm'
};

// Message Types as JSDoc for better IDE support
/**
 * @typedef {Object} BaseMessage
 * @property {string} type - Message type
 * @property {string} clientId - Client identifier
 * @property {string} timestamp - ISO timestamp
 * @property {string} messageId - Unique message ID
 */

/**
 * @typedef {BaseMessage} ChatMessage
 * @property {string} content - Message content
 * @property {string} conversationId - Conversation identifier
 */

/**
 * @typedef {BaseMessage} ResponseMessage
 * @property {string} content - Response content
 * @property {string} conversationId - Conversation identifier
 * @property {string} [replyTo] - Original message ID being replied to
 */

/**
 * @typedef {BaseMessage} ErrorMessage
 * @property {string} error - Error message
 * @property {string} [details] - Detailed error information
 * @property {string} [code] - Error code
 */

/**
 * @typedef {BaseMessage} ConfirmationMessage
 * @property {string} messageId - ID of the message being confirmed
 */

export const MessageTypes = {
  BASE: /** @type {BaseMessage} */ ({}),
  CHAT: /** @type {ChatMessage} */ ({}),
  RESPONSE: /** @type {ResponseMessage} */ ({}),
  ERROR: /** @type {ErrorMessage} */ ({}),
  CONFIRM: /** @type {ConfirmationMessage} */ ({})
};