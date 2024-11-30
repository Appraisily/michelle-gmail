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
    logger.debug('Starting image processing', {
      fileCount: files.length,
      files: files.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.buffer.length,
        encoding: f.encoding
      }))
    });

    for (const file of files) {
      const imageId = uuidv4();
      
      logger.debug('Processing individual image', {
        imageId,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.buffer.length
      });

      // Process image with sharp
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      logger.debug('Image metadata retrieved', {
        imageId,
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation
      });

      // Resize if dimensions exceed limit
      if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
        logger.debug('Resizing image', {
          imageId,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          maxDimension: MAX_DIMENSION
        });

        image.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Convert to optimized format
      let processedBuffer;
      if (metadata.format === 'gif') {
        logger.debug('Keeping GIF format as is', {
          imageId,
          originalSize: file.buffer.length
        });
        processedBuffer = file.buffer;
      } else {
        logger.debug('Converting to optimized JPEG', {
          imageId,
          originalFormat: metadata.format,
          quality: JPEG_QUALITY
        });
        
        processedBuffer = await image
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer();
      }

      const processedMetadata = await sharp(processedBuffer).metadata();

      processedImages.push({
        id: imageId,
        mimeType: metadata.format === 'gif' ? 'image/gif' : 'image/jpeg',
        data: processedBuffer,
        filename: file.originalname
      });

      logger.debug('Image processing completed', {
        imageId,
        originalSize: file.buffer.length,
        processedSize: processedBuffer.length,
        compressionRatio: (processedBuffer.length / file.buffer.length * 100).toFixed(2) + '%',
        originalFormat: metadata.format,
        finalFormat: processedMetadata.format,
        finalWidth: processedMetadata.width,
        finalHeight: processedMetadata.height
      });
    }

    logger.info('All images processed successfully', {
      totalImages: files.length,
      processedImages: processedImages.map(img => ({
        id: img.id,
        mimeType: img.mimeType,
        size: img.data.length,
        filename: img.filename
      }))
    });

    return processedImages;
  } catch (error) {
    logger.error('Error processing images:', {
      error: error.message,
      stack: error.stack,
      files: files.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.buffer.length
      }))
    });

    throw {
      code: ErrorCodes.IMAGE_PROCESSING_ERROR,
      message: 'Failed to process images',
      details: [error.message]
    };
  }
}