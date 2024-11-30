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
    let processedImages = [];
    if (req.files?.length > 0) {
      logger.info('Starting image processing pipeline', {
        fileCount: req.files.length,
        files: req.files.map(f => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          encoding: f.encoding,
          mimetype: f.mimetype,
          size: f.size,
          bufferLength: f.buffer?.length
        })),
        timestamp: new Date().toISOString()
      });

      processedImages = await processImages(req.files);

      logger.info('Image processing completed', {
        processedCount: processedImages.length,
        images: processedImages.map(img => ({
          id: img.id,
          mimeType: img.mimeType,
          size: img.data.length,
          filename: img.filename,
          dataPreview: img.data.slice(0, 50).toString('hex')
        })),
        timestamp: new Date().toISOString()
      });
    }

    // Get OpenAI client
    const openai = await getOpenAIClient();

    // Build messages array
    const messages = [
      {
        role: "system",
        content: `You are Michelle Thompson, an expert art appraiser at Appraisily.
                 Your task is to provide clear, concise, and professional descriptions of art and antique items.

                 When analyzing images:
                 - Focus on key visual characteristics
                 - Describe materials, style, and condition
                 - Highlight notable features or unique aspects
                 - Keep descriptions clear and professional
                 - Avoid speculating about value
                 - Respond directly to the user's specific request

                 Use this company knowledge base for context: ${JSON.stringify(companyKnowledge)}

                 IMPORTANT: 
                 - Provide direct, focused responses
                 - Stay on topic
                 - Be concise but informative
                 - Address the specific request in the message`
      }
    ];

    // Add user message with images if present
    if (processedImages.length > 0) {
      logger.info('Preparing OpenAI message with images', {
        imageCount: processedImages.length,
        textLength: req.body.text.length,
        images: processedImages.map(img => ({
          id: img.id,
          mimeType: img.mimeType,
          dataSize: img.data.length,
          bufferType: img.data.constructor.name,
          isBuffer: Buffer.isBuffer(img.data)
        })),
        timestamp: new Date().toISOString()
      });

      const content = [
        { type: "text", text: req.body.text },
        ...processedImages.map(img => {
          const base64Data = img.data.toString('base64');
          logger.info('Image base64 conversion', {
            imageId: img.id,
            mimeType: img.mimeType,
            originalSize: img.data.length,
            base64Length: base64Data.length,
            base64Preview: base64Data.substring(0, 100) + '...',
            isValidBase64: /^[A-Za-z0-9+/=]+$/.test(base64Data),
            timestamp: new Date().toISOString()
          });

          const imageUrl = `data:${img.mimeType};base64,${base64Data}`;
          logger.info('Image URL format', {
            imageId: img.id,
            urlLength: imageUrl.length,
            urlPrefix: imageUrl.substring(0, 50) + '...',
            timestamp: new Date().toISOString()
          });

          return {
            type: "image_url",
            image_url: {
              url: imageUrl
            }
          };
        })
      ];

      logger.info('Final content array structure', {
        contentLength: content.length,
        textContent: content[0],
        imageUrls: content.slice(1).map(item => ({
          type: item.type,
          urlLength: item.image_url.url.length,
          urlPrefix: item.image_url.url.substring(0, 50) + '...'
        })),
        timestamp: new Date().toISOString()
      });

      messages.push({
        role: "user",
        content
      });
    } else {
      messages.push({
        role: "user",
        content: req.body.text
      });
    }

    logger.info('OpenAI API request payload', {
      model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini",
      messageCount: messages.length,
      hasImages: processedImages.length > 0,
      textLength: req.body.text.length,
      messagesStructure: messages.map(msg => ({
        role: msg.role,
        contentType: typeof msg.content === 'string' ? 'string' : 'array',
        contentLength: typeof msg.content === 'string' ? 
          msg.content.length : 
          msg.content.length
      })),
      timestamp: new Date().toISOString()
    });

    // Generate response
    const completion = await openai.chat.completions.create({
      model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    logger.info('OpenAI API response', {
      choicesLength: completion.choices.length,
      firstChoiceLength: completion.choices[0].message.content.length,
      modelUsed: completion.model,
      usage: completion.usage,
      timestamp: new Date().toISOString()
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
      model: processedImages.length > 0 ? "gpt-4o" : "gpt-4o-mini",
      timestamp: new Date().toISOString()
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
      processingTime: getProcessingTime(processingStart),
      timestamp: new Date().toISOString()
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