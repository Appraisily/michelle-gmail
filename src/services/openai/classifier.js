import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { classificationPrompts } from './classificationPrompts.js';
import { getOpenAIClient } from './client.js';
import { parseOpenAIResponse } from './utils/responseParser.js';

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

    // Initial classification without function calling
    const classificationResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `${classificationPrompts.base(companyKnowledge)}
          
          IMPORTANT: Respond with a plain JSON object only, no markdown formatting.
          The response should be a raw JSON object containing:
          {
            "intent": "APPRAISAL_LEAD" | "STATUS_INQUIRY" | "TECHNICAL_SUPPORT" | "GENERAL_INQUIRY" | "PAYMENT_ISSUE" | "FEEDBACK",
            "urgency": "high" | "medium" | "low",
            "requiresReply": boolean,
            "reason": string,
            "suggestedResponseType": "detailed" | "brief" | "confirmation"
          }`
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    // Parse response using the new utility
    const classification = parseOpenAIResponse(classificationResponse.choices[0].message.content);

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