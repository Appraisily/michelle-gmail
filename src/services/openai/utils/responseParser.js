import { logger } from '../../../utils/logger.js';

/**
 * Clean and parse OpenAI response to extract valid JSON
 * @param {string} response Raw response from OpenAI
 * @returns {Object} Parsed JSON object
 */
export function parseOpenAIResponse(response) {
  try {
    // If it's already valid JSON, return parsed
    try {
      return JSON.parse(response);
    } catch (e) {
      // Continue with cleanup if direct parse fails
    }

    // Remove markdown code blocks if present
    let cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();

    // Parse the cleaned response
    const parsed = JSON.parse(cleaned);

    logger.debug('Successfully parsed OpenAI response', {
      originalLength: response.length,
      cleanedLength: cleaned.length,
      timestamp: new Date().toISOString()
    });

    return parsed;
  } catch (error) {
    logger.error('Error parsing OpenAI response:', {
      error: error.message,
      response: response,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw new Error(`Failed to parse OpenAI response: ${error.message}`);
  }
}