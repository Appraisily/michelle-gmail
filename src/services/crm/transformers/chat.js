import { MessageType, ResponseType } from '../../pubsub/types/crm.js';

/**
 * Transform chat data to CRM message format
 * @param {Object} chatData Chat processing data
 * @returns {import('../../pubsub/types/crm.js').CRMMessage}
 */
export function transformChatToCRM(chatData) {
  return {
    type: MessageType.CHAT,
    source: {
      id: chatData.messageId,
      channel: 'websocket',
      timestamp: chatData.timestamp
    },
    customer: {
      id: chatData.clientId,
      metadata: {
        conversationId: chatData.conversationId,
        sessionDuration: chatData.duration,
        messageCount: chatData.messageCount
      }
    },
    interaction: {
      type: chatData.classification?.intent || 'UNKNOWN',
      content: chatData.content,
      classification: chatData.classification,
      attachments: chatData.images?.map(img => ({
        type: img.mimeType,
        data: img.data.toString('base64'),
        analysis: chatData.imageAnalysis
      }))
    },
    response: chatData.response ? {
      content: chatData.response.content,
      type: ResponseType.AUTO,
      metadata: {
        processingTime: chatData.processingTime
      }
    } : undefined
  };
}