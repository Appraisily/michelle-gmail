import { logger } from '../../../utils/logger.js';

export class MessageStore {
  constructor() {
    this.messages = new Map();
    this.conversationStates = new Map();
  }

  async saveMessage(clientId, message) {
    try {
      const clientMessages = this.messages.get(clientId) || [];
      clientMessages.push({
        ...message,
        timestamp: new Date().toISOString()
      });
      this.messages.set(clientId, clientMessages);

      logger.debug('Message saved to store', {
        clientId,
        messageId: message.messageId,
        status: message.status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to save message:', {
        error: error.message,
        clientId,
        messageId: message.messageId,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }

  async updateMessageStatus(clientId, messageId, status) {
    try {
      const clientMessages = this.messages.get(clientId) || [];
      const message = clientMessages.find(m => m.messageId === messageId);
      
      if (message) {
        message.status = status;
        message.lastUpdate = new Date().toISOString();
        
        logger.debug('Message status updated in store', {
          clientId,
          messageId,
          status,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error('Failed to update message status:', {
        error: error.message,
        clientId,
        messageId,
        status,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }

  async saveConversationState(clientId, state) {
    try {
      this.conversationStates.set(clientId, {
        ...state,
        timestamp: new Date().toISOString()
      });

      logger.debug('Conversation state saved', {
        clientId,
        conversationId: state.conversationId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to save conversation state:', {
        error: error.message,
        clientId,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }

  async getConversationState(clientId) {
    return this.conversationStates.get(clientId) || null;
  }

  async getMessages(clientId) {
    try {
      return this.messages.get(clientId) || [];
    } catch (error) {
      logger.error('Failed to get messages:', {
        error: error.message,
        clientId,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return [];
    }
  }

  async cleanup(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    try {
      const now = Date.now();

      // Clean up messages
      for (const [clientId, messages] of this.messages.entries()) {
        const filtered = messages.filter(msg => {
          const age = now - new Date(msg.timestamp).getTime();
          return age <= maxAge;
        });
        if (filtered.length !== messages.length) {
          this.messages.set(clientId, filtered);
          logger.info('Cleaned up old messages', {
            clientId,
            removed: messages.length - filtered.length,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Clean up conversation states
      for (const [clientId, state] of this.conversationStates.entries()) {
        const age = now - new Date(state.timestamp).getTime();
        if (age > maxAge) {
          this.conversationStates.delete(clientId);
          logger.info('Cleaned up old conversation state', {
            clientId,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup store:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
  }
}

export const messageStore = new MessageStore();