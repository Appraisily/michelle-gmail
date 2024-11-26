import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

let openaiClient = null;

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
    logger.error('Failed to initialize OpenAI client:', error);
    throw error;
  }
}