import { logger } from '../../utils/logger.js';
import { validateDirectMessage } from './validator.js';
import { processImages } from './imageProcessor.js';
import { getOpenAIClient } from '../openai/client.js';
import { ErrorCodes } from './types.js';
import { recordMetric } from '../../utils/monitoring.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';

const startTime = () => process.hrtime();
const getProcessingTime = (start) => {
  const [seconds, nanoseconds] = process.hrtime(start);
  return `${(seconds * 1000 + nanoseconds / 1000000).toFixed(0)}ms`;
};

/**
 * Process a direct message with optional images
 * @param {DirectMessageRequest} req Express request object
 * @returns {Promise<DirectMessageResponse>} Processing result
 */
export async function processDirectMessage(req) {
  const processingStart = startTime();

  try {
    // Validate request
    const validation = validateDirectMessage(req);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error
      };
    }

    // Process images if present
    const processedImages = req.files?.length > 0 ?
      await processImages(req.files) : [];

    // Get OpenAI client
    const openai = await getOpenAIClient();

    // Build messages array
    const messages = [
      {
        role: "system",
        content: `You are Michelle Thompson, a professional customer service representative for Appraisily.
                 Use this company knowledge base: ${JSON.stringify(companyKnowledge)}
                 
                 Guidelines:
                 - Be friendly and professional
                 - Provide accurate information
                 - Never provide specific valuations without formal appraisal
                 - Keep responses focused and relevant
                 - Include next steps when appropriate`
      },
      {
        role: "user",
        content: processedImages.length > 0 ? [
          { type: "text", text: req.body.text },
          ...processedImages.map(img => ({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.data.toString('base64')}`
            }
          }))
        ] : req.body.text
      }
    ];

    // Generate response
    const completion = await openai.chat.completions.create({
      model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const response = completion.choices[0].message.content;

    // Record metrics
    recordMetric('direct_messages_processed', 1);
    if (processedImages.length > 0) {
      recordMetric('direct_message_images_processed', processedImages.length);
    }

    logger.info('Direct message processed successfully', {
      processingTime: getProcessingTime(processingStart),
      imagesProcessed: processedImages.length,
      responseLength: response.length,
      model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini"
    });

    return {
      success: true,
      response: {
        text: response,
        metadata: {
          processingTime: getProcessingTime(processingStart),
          imagesProcessed: processedImages.length,
          model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini"
        }
      }
    };

  } catch (error) {
    logger.error('Error processing direct message:', {
      error: error.message,
      stack: error.stack,
      processingTime: getProcessingTime(processingStart)
    });

    recordMetric('direct_message_errors', 1);

    return {
      success: false,
      error: {
        code: error.code || ErrorCodes.INTERNAL_ERROR,
        message: error.message || 'Internal server error',
        details: error.details || [error.message]
      }
    };
  }
}