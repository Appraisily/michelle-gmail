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
 * @typedef {Object} Message
 * @property {string} type - Message type (message, response, error, etc)
 * @property {string} clientId - Client identifier
 * @property {string} messageId - Unique message identifier
 * @property {string} [content] - Message content
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