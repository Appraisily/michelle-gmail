// Message Types
export const MessageType = {
  CONNECT: 'connect',
  CONNECT_CONFIRM: 'connect_confirm',
  MESSAGE: 'message',
  RESPONSE: 'response',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  CONFIRM: 'confirm',
  IMAGE_STATUS: 'image_status',
  DISCONNECT: 'disconnect',
  STATUS: 'status'
};

// Connection States (WebSocket states)
export const ConnectionState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

// Connection Status
export const ConnectionStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  DISCONNECTED: 'disconnected'
};

// Image validation constants
export const ImageValidation = {
  SUPPORTED_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ],
  MAX_SIZE: 10 * 1024 * 1024 // 10MB
};

// Message Status
export const MessageStatus = {
  SENT: 'sent',
  RECEIVED: 'received',
  PROCESSED: 'processed',
  FAILED: 'failed'
};

// Activity Types for Tracking
export const ActivityType = {
  MESSAGE: 'message',
  RESPONSE: 'response',
  SYSTEM: 'system',
  HEARTBEAT: 'heartbeat'
};