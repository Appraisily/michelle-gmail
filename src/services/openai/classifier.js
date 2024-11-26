import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { systemPrompts } from './prompts.js';
import { getOpenAIClient } from './client.js';
import { dataHubClient } from '../dataHub/client.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o-mini';

async function validateApiInfo(apiInfo) {
  try {
    if (!apiInfo || typeof apiInfo !== 'object') {
      logger.warn('Invalid API info received, fetching fresh data');
      return await dataHubClient.fetchEndpoints();
    }

    // Validate endpoints structure
    if (!Array.isArray(apiInfo.endpoints)) {
      logger.warn('Invalid endpoints structure:', {
        endpoints: apiInfo.endpoints,
        type: typeof apiInfo.endpoints
      });
      apiInfo.endpoints = [];
    }

    // Validate authentication
    if (!apiInfo.authentication || typeof apiInfo.authentication !== 'object') {
      logger.warn('Invalid authentication structure:', {
        authentication: apiInfo.authentication,
        type: typeof apiInfo.authentication
      });
      apiInfo.authentication = {};
    }

    // Validate rate limiting
    if (!apiInfo.rateLimiting || typeof apiInfo.rateLimiting !== 'object') {
      logger.warn('Invalid rate limiting structure:', {
        rateLimiting: apiInfo.rateLimiting,
        type: typeof apiInfo.rateLimiting
      });
      apiInfo.rateLimiting = {};
    }

    return apiInfo;
  } catch (error) {
    logger.error('Error validating API info:', {
      error: error.message,
      stack: error.stack
    });
    return {
      endpoints: [],
      authentication: {},
      rateLimiting: {}
    };
  }
}

export async function classifyEmail(
  emailContent,
  senderEmail,
  threadMessages = null,
  imageAttachments = null,
  companyKnowledge,
  apiInfo
) {
  try {
    logger.debug('Starting email classification', {
      hasThread: !!threadMessages,
      threadLength: threadMessages?.length,
      hasImages: !!imageAttachments?.length,
      senderEmail,
      contentLength: emailContent?.length
    });

    // Validate API info structure
    const validatedApiInfo = await validateApiInfo(apiInfo);

    const openai = await getOpenAIClient();
    
    // Format thread context if available
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    logger.debug('Preparing classification request', {
      hasThreadContext: !!threadContext,
      fullContextLength: fullContext.length,
      apiEndpoints: validatedApiInfo.endpoints.length
    });

    // Initial classification
    const classificationResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge, validatedApiInfo)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const classification = parseClassificationResponse(classificationResponse);

    // If there are images, mark as APPRAISAL_LEAD
    if (imageAttachments && imageAttachments.length > 0) {
      classification.intent = "APPRAISAL_LEAD";
      classification.requiresReply = true;
    }

    recordMetric('email_classifications', 1);
    
    logger.info('Email classification completed', {
      intent: classification.intent,
      urgency: classification.urgency,
      requiresReply: classification.requiresReply
    });

    return {
      classification,
      requiresReply: classification.requiresReply
    };

  } catch (error) {
    logger.error('Error in classifier:', {
      error: error.message,
      stack: error.stack,
      context: {
        hasThread: !!threadMessages,
        senderEmail,
        hasImages: !!imageAttachments
      }
    });
    recordMetric('classification_failures', 1);
    throw error;
  }
}

function parseClassificationResponse(response) {
  try {
    if (!response.choices?.[0]?.message?.content) {
      logger.warn('Invalid classification response format');
      return {
        intent: "unknown",
        urgency: "medium",
        requiresReply: true,
        reason: "Unable to parse classification",
        suggestedResponseType: "detailed"
      };
    }

    const content = response.choices[0].message.content;

    try {
      return JSON.parse(content);
    } catch (e) {
      logger.warn('Failed to parse JSON response:', {
        error: e.message,
        content
      });

      return {
        intent: "unknown",
        urgency: "medium",
        requiresReply: content.toLowerCase().includes('requires reply'),
        reason: content.slice(0, 200),
        suggestedResponseType: "detailed"
      };
    }
  } catch (error) {
    logger.error('Error parsing classification:', error);
    return {
      intent: "unknown",
      urgency: "medium",
      requiresReply: true,
      reason: "Error parsing response",
      suggestedResponseType: "detailed"
    };
  }
}

function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) {
    return '';
  }

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}