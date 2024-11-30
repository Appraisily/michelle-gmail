import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { ErrorCodes } from './types.js';

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 85;

/**
 * Process and optimize images for OpenAI analysis
 * @param {Express.Multer.File[]} files Array of uploaded files
 * @returns {Promise<ProcessedImage[]>} Processed images
 */
export async function processImages(files) {
  const processedImages = [];

  try {
    for (const file of files) {
      const imageId = uuidv4();
      
      // Process image with sharp
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      // Resize if dimensions exceed limit
      if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
        image.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Convert to optimized format
      let processedBuffer;
      if (metadata.format === 'gif') {
        // Keep GIFs as is
        processedBuffer = file.buffer;
      } else {
        // Convert to JPEG for other formats
        processedBuffer = await image
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
      }

      processedImages.push({
        id: imageId,
        mimeType: metadata.format === 'gif' ? 'image/gif' : 'image/jpeg',
        data: processedBuffer,
        filename: file.originalname
      });

      logger.debug('Image processed successfully', {
        id: imageId,
        originalSize: file.size,
        processedSize: processedBuffer.length,
        originalFormat: metadata.format,
        width: metadata.width,
        height: metadata.height
      });
    }

    return processedImages;
  } catch (error) {
    logger.error('Error processing images:', {
      error: error.message,
      stack: error.stack
    });

    throw {
      code: ErrorCodes.IMAGE_PROCESSING_ERROR,
      message: 'Failed to process images',
      details: [error.message]
    };
  }
}