import { classifyEmail } from './classifier.js';
import { generateResponse } from './response/generator.js';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';

export async function classifyAndProcessEmail(emailContent, senderEmail, threadMessages = null, imageAttachments = null) {
  try {
    // Get API info for classification
    const apiInfo = await dataHubClient.fetchEndpoints();

    // First classify the email
    const { classification, customerData, requiresReply } = await classifyEmail(
      emailContent,
      senderEmail,
      threadMessages,
      imageAttachments,
      companyKnowledge,
      apiInfo
    );

    if (!requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: classification.reason,
        classification,
        customerData
      };
    }

    // Generate response if needed
    const { generatedReply, imageAnalysis } = await generateResponse(
      emailContent,
      classification,
      customerData,
      threadMessages,
      imageAttachments,
      companyKnowledge
    );

    return {
      requiresReply: true,
      generatedReply,
      reason: classification.reason,
      classification,
      customerData,
      imageAnalysis
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', {
      error: error.message,
      stack: error.stack,
      context: {
        hasThread: !!threadMessages,
        senderEmail,
        hasImages: !!imageAttachments
      }
    });
    throw error;
  }
}