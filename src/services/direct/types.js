/**
 * @typedef {Object} DirectMessageRequest
 * @property {string} text - Message text content
 * @property {Express.Multer.File[]} [images] - Optional array of image files
 * @property {string} [senderEmail] - Optional sender email for context
 * @property {string} [senderName] - Optional sender name
 * @property {Object} [context] - Optional additional context
 * @property {string} [context.threadId] - Optional thread ID
 * @property {string} [context.conversationId] - Optional conversation ID
 */

/**
 * @typedef {Object} ProcessedImage
 * @property {string} id - Unique image identifier
 * @property {string} mimeType - Image MIME type
 * @property {Buffer} data - Processed image data
 * @property {string} [filename] - Original filename
 */

/**
 * @typedef {Object} DirectMessageResponse
 * @property {boolean} success - Whether the request was successful
 * @property {Object} [response] - Response data if successful
 * @property {string} response.text - Generated response text
 * @property {string} [response.imageAnalysis] - Image analysis if images were provided
 * @property {Object} response.metadata - Processing metadata
 * @property {string} response.metadata.processingTime - Time taken to process
 * @property {number} response.metadata.imagesProcessed - Number of images processed
 * @property {string} response.metadata.model - OpenAI model used
 * @property {Object} [error] - Error data if unsuccessful
 * @property {string} error.code - Error code
 * @property {string} error.message - Error message
 * @property {string[]} [error.details] - Detailed error information
 */

export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  IMAGE_PROCESSING_ERROR: 'IMAGE_PROCESSING_ERROR',
  OPENAI_ERROR: 'OPENAI_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};