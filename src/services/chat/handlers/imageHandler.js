import { logger } from '../../../utils/logger.js';
import { connectionManager } from '../connection/manager.js';
import { MessageType, ImageProcessingStatus, ImageValidation } from '../connection/types.js';
import { processImages } from '../processor.js';

/**
 * Validate image data
 * @param {Object} image Image data object
 * @returns {Object} Validation result
 */
function validateImage(image) {
  const errors = [];

  if (!image.data) {
    errors.push('Missing image data');
  }

  if (!image.mimeType) {
    errors.push('Missing MIME type');
  } else if (!ImageValidation.SUPPORTED_TYPES.includes(image.mimeType)) {
    errors.push(`Unsupported image type: ${image.mimeType}`);
  }

  // Check size if data is present
  if (image.data) {
    // If data includes base64 prefix, remove it for size calculation
    let base64Data = image.data;
    if (typeof base64Data === 'string' && base64Data.includes('base64,')) {
      base64Data = base64Data.split('base64,')[1];
    }
    
    const size = Buffer.from(base64Data, 'base64').length;
    if (size > ImageValidation.MAX_SIZE) {
      errors.push(`Image size exceeds maximum allowed (${ImageValidation.MAX_SIZE} bytes)`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Handle image processing and status updates
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} message Client message
 * @param {Object} client Client data
 */
export async function handleImages(ws, message, client) {
  if (!message.images || !Array.isArray(message.images)) {
    return;
  }

  logger.info('Processing images', {
    clientId: client.id,
    messageId: message.messageId,
    imageCount: message.images.length,
    timestamp: new Date().toISOString()
  });

  // Process each image
  for (const image of message.images) {
    try {
      // Validate image
      const validation = validateImage(image);
      if (!validation.isValid) {
        await sendImageStatus(ws, client, message.messageId, image.id, ImageProcessingStatus.FAILED, validation.errors);
        continue;
      }

      // Send received status
      await sendImageStatus(ws, client, message.messageId, image.id, ImageProcessingStatus.RECEIVED);

      // Send processing status
      await sendImageStatus(ws, client, message.messageId, image.id, ImageProcessingStatus.PROCESSING);

      // Process base64 data
      let processedData = image.data;
      if (typeof processedData === 'string' && processedData.includes('base64,')) {
        processedData = processedData.split('base64,')[1];
      }

      // Process image with cleaned base64 data
      const analysis = await processImages([{
        ...image,
        data: processedData
      }]);

      // Send analyzed status with results
      await sendImageStatus(ws, client, message.messageId, image.id, ImageProcessingStatus.ANALYZED, null, analysis);

    } catch (error) {
      logger.error('Error processing image', {
        error: error.message,
        clientId: client.id,
        messageId: message.messageId,
        imageId: image.id,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });

      await sendImageStatus(ws, client, message.messageId, image.id, ImageProcessingStatus.FAILED, [error.message]);
    }
  }
}

/**
 * Send image status update
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} client Client data
 * @param {string} messageId Original message ID
 * @param {string} imageId Image identifier
 * @param {ImageProcessingStatus} status Processing status
 * @param {string[]|null} errors Error messages if any
 * @param {Object|null} analysis Analysis results if any
 */
async function sendImageStatus(ws, client, messageId, imageId, status, errors = null, analysis = null) {
  await connectionManager.sendMessage(ws, {
    type: MessageType.IMAGE_STATUS,
    clientId: client.id,
    messageId,
    imageId,
    status,
    ...(errors && { errors }),
    ...(analysis && { analysis }),
    timestamp: new Date().toISOString()
  });
}