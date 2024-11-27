import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

let openaiClient = null;

/**
 * Format image data for OpenAI API
 * @param {string} mimeType MIME type of the image
 * @param {string} data Base64 encoded image data
 * @returns {Object} Formatted image data for API
 */
function formatImageData(mimeType, data) {
  return {
    type: "image_url",
    image_url: {
      url: `data:${mimeType};base64,${data}`
    }
  };
}

/**
 * Get or initialize OpenAI client
 * @returns {Promise<OpenAI>} OpenAI client instance
 */
export async function getOpenAIClient() {
  try {
    if (openaiClient) {
      return openaiClient;
    }

    const secrets = await getSecrets();
    if (!secrets.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found in Secret Manager');
    }

    openaiClient = new OpenAI({
      apiKey: secrets.OPENAI_API_KEY
    });

    logger.info('OpenAI client initialized successfully');
    return openaiClient;
  } catch (error) {
    logger.error('Failed to initialize OpenAI client:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Create chat completion with optional image input
 * @param {Object} params Chat completion parameters
 * @param {Array} params.messages Message array
 * @param {Array} [params.images] Optional array of image data
 * @param {Object} [params.options] Additional OpenAI API options
 * @returns {Promise<Object>} Chat completion response
 */
export async function createChatCompletion({ messages, images = [], options = {} }) {
  try {
    const openai = await getOpenAIClient();

    // If there are images, format the messages array to include them
    const formattedMessages = messages.map(msg => {
      if (msg.role === 'user' && images.length > 0 && msg === messages[messages.length - 1]) {
        return {
          role: msg.role,
          content: [
            { type: "text", text: msg.content },
            ...images.map(img => formatImageData(img.mimeType, img.data))
          ]
        };
      }
      return {
        role: msg.role,
        content: [{ type: "text", text: msg.content }]
      };
    });

    logger.debug('Creating chat completion', {
      messageCount: messages.length,
      hasImages: images.length > 0,
      model: options.model || 'gpt-4o'
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: formattedMessages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 500,
      ...options
    });

    logger.debug('Chat completion received', {
      choiceCount: completion.choices.length,
      usage: completion.usage
    });

    return completion;
  } catch (error) {
    logger.error('Error creating chat completion:', {
      error: error.message,
      stack: error.stack,
      hasImages: images.length > 0
    });
    throw error;
  }
}

/**
 * Create chat completion specifically for image analysis
 * @param {Array} images Array of image data objects
 * @param {string} prompt Analysis prompt
 * @param {Object} [options] Additional OpenAI API options
 * @returns {Promise<Object>} Analysis response
 */
export async function analyzeImages(images, prompt, options = {}) {
  try {
    const messages = [{
      role: 'system',
      content: 'You are an expert art and antiques appraiser. Analyze the provided images and provide detailed observations about the items shown.'
    }, {
      role: 'user',
      content: prompt
    }];

    logger.info('Starting image analysis', {
      imageCount: images.length,
      promptLength: prompt.length
    });

    const completion = await createChatCompletion({
      messages,
      images,
      options: {
        temperature: 0.5,
        max_tokens: 1000,
        ...options
      }
    });

    return completion.choices[0].message.content;
  } catch (error) {
    logger.error('Error analyzing images:', {
      error: error.message,
      stack: error.stack,
      imageCount: images.length
    });
    throw error;
  }
}