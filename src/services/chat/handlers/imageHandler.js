import { logger } from '../../../utils/logger.js';
import { ImageValidation } from '../connection/types.js';

/**
 * Validate and prepare images for processing
 * @param {Array} images Array of image objects
 * @returns {Object} Validation result with prepared images if valid
 */
export function validateAndPrepareImages(images) {
  if (!Array.isArray(images)) {
    return {
      isValid: false,
      errors: ['Invalid image data format'],
      images: []
    };
  }

  const errors = [];
  const validImages = [];

  for (const [index, image] of images.entries()) {
    const validation = validateImage(image);
    if (!validation.isValid) {
      errors.push(`Image ${index + 1}: ${validation.errors.join(', ')}`);
      continue;
    }

    // Process base64 data
    let processedData = image.data;
    if (typeof processedData === 'string' && processedData.includes('base64,')) {
      processedData = processedData.split('base64,')[1];
    }

    validImages.push({
      ...image,
      data: processedData
    });
  }

  logger.info('Image validation completed', {
    totalImages: images.length,
    validCount: validImages.length,
    hasErrors: errors.length > 0,
    timestamp: new Date().toISOString()
  });

  return {
    isValid: errors.length === 0,
    errors,
    images: validImages
  };
}

/**
 * Validate individual image
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