import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classifyAndProcessEmail } from '../openai/index.js';
import { dataHubClient } from '../dataHub/client.js';

const MAX_CONTEXT_LENGTH = 2000; // Maximum length for context to prevent token limits
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

function truncateContext(context) {
  if (!context || context.length <= MAX_CONTEXT_LENGTH) {
    return context;
  }
  return context.slice(context.length - MAX_CONTEXT_LENGTH);
}

function formatMessageForOpenAI(message) {
  try {
    // Validate required fields
    if (!message.content) {
      throw new Error('Message content is required');
    }

    // Format context if available
    const context = message.context ? truncateContext(message.context) : null;

    // Format images if available
    const images = message.images?.map(img => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
      }
    })) || null;

    // Create formatted message
    const formattedMessage = {
      content: message.content.trim(),
      ...(context && { context }),
      ...(images && { images }),
      email: message.email || 'chat-user',
      timestamp: message.timestamp || new Date().toISOString()
    };

    logger.debug('Formatted message for OpenAI', {
      hasContent: !!formattedMessage.content,
      hasContext: !!formattedMessage.context,
      imageCount: formattedMessage.images?.length || 0,
      email: formattedMessage.email
    });

    return formattedMessage;
  } catch (error) {
    logger.error('Error formatting message:', {
      error: error.message,
      stack: error.stack,
      originalMessage: message
    });
    throw error;
  }
}

async function fetchApiInfo() {
  try {
    const apiInfo = await dataHubClient.fetchEndpoints();
    logger.debug('Fetched API info', {
      endpointCount: apiInfo.endpoints?.length,
      hasAuthentication: !!apiInfo.authentication,
      hasRateLimiting: !!apiInfo.rateLimiting
    });
    return apiInfo;
  } catch (error) {
    logger.error('Error fetching API info:', error);
    return null;
  }
}

async function processWithRetry(message, clientId, retryCount = 0) {
  try {
    const formattedMessage = formatMessageForOpenAI(message);
    const apiInfo = await fetchApiInfo();

    const result = await classifyAndProcessEmail(
      formattedMessage.content,
      formattedMessage.email,
      formattedMessage.context ? [{ content: formattedMessage.context, isIncoming: true }] : null,
      formattedMessage.images,
      apiInfo
    );

    logger.info('Chat message processed successfully', {
      clientId,
      messageId: result.messageId,
      classification: result.classification?.intent,
      hasReply: !!result.generatedReply
    });

    recordMetric('chat_responses_generated', 1);

    return {
      messageId: message.id || uuidv4(),
      reply: result.generatedReply,
      classification: result.classification,
      imageAnalysis: result.imageAnalysis,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn('Retrying chat message processing', {
        clientId,
        retryCount,
        error: error.message
      });

      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return processWithRetry(message, clientId, retryCount + 1);
    }

    logger.error('Chat processing failed after retries:', {
      error: error.message,
      stack: error.stack,
      clientId,
      retryCount
    });

    recordMetric('chat_processing_errors', 1);
    throw error;
  }
}

export async function classifyAndProcessChat(message, clientId) {
  try {
    logger.info('Processing chat message', {
      clientId,
      messageType: message.type,
      hasContent: !!message.content,
      hasContext: !!message.context,
      hasImages: !!message.images
    });

    // Handle ping messages
    if (message.type === 'ping') {
      return {
        type: 'pong',
        timestamp: new Date().toISOString()
      };
    }

    return await processWithRetry(message, clientId);

  } catch (error) {
    logger.error('Error in chat processor:', {
      error: error.message,
      stack: error.stack,
      clientId
    });

    recordMetric('chat_processing_errors', 1);
    throw error;
  }
}