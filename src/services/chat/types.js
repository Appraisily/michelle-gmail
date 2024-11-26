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

// Message Interfaces
export interface BaseMessage {
  type: string;
  clientId: string;
  timestamp: string;
  messageId: string;
}

export interface ChatMessage extends BaseMessage {
  content: string;
  conversationId: string;
}

export interface ResponseMessage extends BaseMessage {
  content: string;
  conversationId: string;
  replyTo?: string;
}

export interface ErrorMessage extends BaseMessage {
  error: string;
  details?: string;
  code?: string;
}

export interface ConfirmationMessage extends BaseMessage {
  messageId: string;
}