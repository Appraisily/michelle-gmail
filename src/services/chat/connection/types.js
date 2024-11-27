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
  CONFIRM: 'confirm'
};

export const ConnectionStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed'
};