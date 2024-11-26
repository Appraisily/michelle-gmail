import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classifyAndProcessEmail } from '../openai/index.js';

export async function classifyAndProcessChat(message, clientId) {
  try {
    logger.info('Processing chat message', {
      clientId,
      messageType: message.type
    });

    // Process message using same pipeline as email
    const result = await classifyAndProcessEmail(
      message.content,
      message.email || 'chat-user',
      message.context ? [{ content: message.context, isIncoming: true }] : null,
      message.images || null
    );

    recordMetric('chat_responses_generated', 1);

    return {
      messageId: message.id,
      reply: result.generatedReply,
      classification: result.classification,
      imageAnalysis: result.imageAnalysis
    };

  } catch (error) {
    logger.error('Error in chat processor:', error);
    recordMetric('chat_processing_errors', 1);
    throw error;
  }
}