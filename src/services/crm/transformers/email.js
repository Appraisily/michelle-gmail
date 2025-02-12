import { MessageType, ResponseType } from '../../pubsub/types/crm.js';

/**
 * Transform email data to CRM message format
 * @param {Object} emailData Email processing data
 * @returns {import('../../pubsub/types/crm.js').CRMMessage}
 */
export function transformEmailToCRM(emailData) {
  // Extract sender info
  const senderMatch = emailData.sender.match(/^(?:([^<]*)<)?([^>]+)>?$/);
  const senderName = senderMatch ? senderMatch[1]?.trim() || '' : '';
  const senderEmail = senderMatch ? senderMatch[2]?.trim() || emailData.sender : emailData.sender;

  return {
    type: MessageType.EMAIL,
    source: {
      id: emailData.messageId,
      channel: 'gmail',
      timestamp: emailData.timestamp
    },
    customer: {
      email: senderEmail,
      name: senderName,
      metadata: {
        threadId: emailData.threadId
      }
    },
    interaction: {
      type: emailData.classification?.intent || 'UNKNOWN',
      content: emailData.content,
      classification: emailData.classification,
      attachments: emailData.imageAttachments?.map(img => ({
        type: img.mimeType,
        data: img.buffer.toString('base64'),
        analysis: emailData.imageAnalysis
      }))
    },
    response: emailData.generatedReply ? {
      content: emailData.generatedReply,
      type: ResponseType.AUTO,
      metadata: {
        processingTime: emailData.processingTime
      }
    } : undefined
  };
}