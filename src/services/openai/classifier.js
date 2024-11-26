import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classificationPrompts } from './classificationPrompts.js';
import { getOpenAIClient } from './client.js';
import { emailClassificationFunction } from './functions/classification.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o-mini';

export async function classifyEmail(
  emailContent,
  senderEmail,
  threadMessages = null,
  imageAttachments = null,
  companyKnowledge
) {
  try {
    logger.debug('Starting email classification', {
      hasThread: !!threadMessages,
      threadLength: threadMessages?.length,
      hasImages: !!imageAttachments?.length,
      senderEmail,
      contentLength: emailContent?.length
    });

    const openai = await getOpenAIClient();
    
    // Format thread context if available
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Initial classification with strict function calling
    const classificationResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: classificationPrompts.base(companyKnowledge)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      functions: [emailClassificationFunction],
      function_call: { name: "classifyEmail" },
      temperature: 0.3,
      max_tokens: 500
    });

    // Parse function call response
    const functionCall = classificationResponse.choices[0].message.function_call;
    if (!functionCall || !functionCall.arguments) {
      throw new Error('Invalid classification response format');
    }

    const classification = JSON.parse(functionCall.arguments);

    // Force APPRAISAL_LEAD for messages with images
    if (imageAttachments && imageAttachments.length > 0) {
      classification.intent = "APPRAISAL_LEAD";
      classification.requiresReply = true;
      classification.suggestedResponseType = "detailed";
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

    // Return safe default classification on error
    return {
      classification: {
        intent: "GENERAL_INQUIRY",
        urgency: "medium",
        requiresReply: true,
        reason: "Error during classification, defaulting to safe values",
        suggestedResponseType: "detailed"
      },
      requiresReply: true
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