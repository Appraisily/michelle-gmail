import { MessageType, ResponseType } from '../../pubsub/types/crm.js';

/**
 * Transform direct message data to CRM message format
 * @param {Object} directData Direct message processing data
 * @returns {import('../../pubsub/types/crm.js').CRMMessage}
 */
export function transformDirectToCRM(directData) {
  return {
    type: MessageType.DIRECT,
    source: {
      id: directData.messageId,
      channel: 'api',
      timestamp: directData.timestamp
    },
    customer: {
      email: directData.senderEmail,
      name: directData.senderName,
      metadata: {
        context: directData.context
      }
    },
    interaction: {
      type: directData.classification?.intent || 'UNKNOWN',
      content: directData.text,
      classification: directData.classification,
      attachments: directData.images?.map(img => ({
        type: img.mimeType,
        data: img.data.toString('base64'),
        analysis: directData.imageAnalysis
      }))
    },
    response: directData.response ? {
      content: directData.response.text,
      type: ResponseType.AUTO,
      metadata: {
        processingTime: directData.response.metadata.processingTime
      }
    } : undefined
  };
}