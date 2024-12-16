import { logger } from '../../../utils/logger.js';

// Constants for typing simulation
const BASE_DELAY = 1000; // 1 second base delay
const WORDS_PER_MINUTE = 200; // Average typing speed
const THINKING_TIME = {
  withImages: 3000,
  withoutImages: 1500
};

/**
 * Calculate typing delay based on message content
 * @param {string} message Message content
 * @param {boolean} hasImages Whether message includes images
 * @returns {number} Delay in milliseconds
 */
export function calculateTypingDelay(message, hasImages = false) {
  try {
    // Base thinking time
    const thinkingTime = hasImages ? THINKING_TIME.withImages : THINKING_TIME.withoutImages;
    
    // Calculate typing time based on message length
    const wordCount = message.length / 5; // Approximate words
    const typingTime = (wordCount / WORDS_PER_MINUTE) * 60 * 1000;
    
    // Add random variation (±20%)
    const variation = (Math.random() * 0.4 - 0.2) * (typingTime + thinkingTime);
    
    // Calculate total delay
    const totalDelay = BASE_DELAY + thinkingTime + typingTime + variation;

    logger.debug('Calculated typing delay', {
      messageLength: message.length,
      wordCount,
      hasImages,
      totalDelay,
      timestamp: new Date().toISOString()
    });

    return Math.max(1500, Math.min(totalDelay, 8000)); // Between 1.5 and 8 seconds
  } catch (error) {
    logger.error('Error calculating typing delay:', {
      error: error.message,
      stack: error.stack
    });
    return 2000; // Default delay if calculation fails
  }
}