import { logger } from '../../utils/logger.js';
import { ErrorCodes } from './types.js';

const MAX_TEXT_LENGTH = 4000;
const MAX_IMAGES = 5;
const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];

export function validateDirectMessage(req) {
  const errors = [];

  // Validate text content
  if (!req.body?.text) {
    errors.push('Message text is required');
  } else if (typeof req.body.text !== 'string') {
    errors.push('Message text must be a string');
  } else if (req.body.text.length > MAX_TEXT_LENGTH) {
    errors.push(`Message text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  // Validate images if present
  if (req.files?.length) {
    if (req.files.length > MAX_IMAGES) {
      errors.push(`Maximum of ${MAX_IMAGES} images allowed`);
    }

    req.files.forEach((file, index) => {
      if (!SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
        errors.push(`Unsupported image format at index ${index}: ${file.mimetype}`);
      }
      
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        errors.push(`Image at index ${index} exceeds 10MB size limit`);
      }
    });
  }

  // Validate optional fields
  if (req.body.senderEmail && !isValidEmail(req.body.senderEmail)) {
    errors.push('Invalid sender email format');
  }

  if (req.body.context) {
    try {
      const context = typeof req.body.context === 'string' ? 
        JSON.parse(req.body.context) : req.body.context;

      if (typeof context !== 'object') {
        errors.push('Context must be an object');
      }
    } catch (error) {
      errors.push('Invalid context format');
    }
  }

  if (errors.length > 0) {
    logger.warn('Direct message validation failed', {
      errors,
      body: {
        ...req.body,
        text: req.body.text?.length > 100 ? 
          `${req.body.text.slice(0, 100)}...` : req.body.text
      },
      files: req.files?.map(f => ({
        mimetype: f.mimetype,
        size: f.size
      }))
    });

    return {
      isValid: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        details: errors
      }
    };
  }

  return { isValid: true };
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}