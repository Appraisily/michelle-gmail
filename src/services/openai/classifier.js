import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { systemPrompts } from './prompts.js';
import { dataHubFunctions } from './functions.js';
import { getOpenAIClient } from './client.js';
import { dataHubClient } from '../dataHub/client.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o-mini';

async function handleFunctionCall(functionCall, senderEmail) {
  try {
    const { name, arguments: args } = functionCall;
    const parsedArgs = JSON.parse(args);

    logger.debug('Handling function call in classifier', {
      function: name,
      arguments: parsedArgs,
      senderEmail
    });

    if (name === 'makeDataHubRequest') {
      const { endpoint, method, params } = parsedArgs;
      const finalParams = {
        ...params,
        email: params?.email || senderEmail
      };
      
      return await dataHubClient.makeRequest(endpoint, method, finalParams);
    }

    return null;
  } catch (error) {
    logger.error('Error handling function call in classifier:', error);
    return null;
  }
}

function parseClassificationResponse(response) {
  try {
    logger.debug('Parsing classification response', {
      hasChoices: !!response.choices,
      firstChoice: response.choices?.[0],
      messageContent: response.choices?.[0]?.message?.content
    });

    if (!response.choices?.[0]?.message?.content) {
      return {
        requiresReply: true,
        intent: "unknown",
        urgency: "medium",
        reason: "Unable to parse classification",
        suggestedResponseType: "detailed"
      };
    }

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      logger.debug('Failed to parse JSON response, using text fallback', {
        error: e.message,
        content: response.choices[0].message.content
      });

      const content = response.choices[0].message.content;
      return {
        requiresReply: content.toLowerCase().includes('requires reply') || content.toLowerCase().includes('needs response'),
        intent: "unknown",
        urgency: "medium",
        reason: content.slice(0, 200),
        suggestedResponseType: "detailed"
      };
    }
  } catch (error) {
    logger.error('Error parsing classification response:', error);
    return {
      requiresReply: true,
      intent: "unknown",
      urgency: "medium",
      reason: "Error parsing response",
      suggestedResponseType: "detailed"
    };
  }
}

export async function classifyEmail(emailContent, senderEmail, threadMessages = null, imageAttachments = null, companyKnowledge, apiInfo) {
  try {
    logger.debug('Starting email classification with details', {
      hasThread: !!threadMessages,
      threadLength: threadMessages?.length,
      hasImages: imageAttachments?.length || 0,
      senderEmail,
      emailContentLength: emailContent?.length,
      hasApiInfo: !!apiInfo,
      hasCompanyKnowledge: !!companyKnowledge
    });

    const openai = await getOpenAIClient();
    
    // Format thread context if available
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Ensure apiInfo has the correct structure
    const formattedApiInfo = apiInfo ? {
      endpoints: Array.isArray(apiInfo.endpoints) ? apiInfo.endpoints : [],
      authentication: apiInfo.authentication || {},
      rateLimiting: apiInfo.rateLimiting || {}
    } : {
      endpoints: [],
      authentication: {},
      rateLimiting: {}
    };

    logger.debug('Preparing OpenAI request', {
      model: MODEL,
      threadContext: !!threadContext,
      fullContextLength: fullContext.length,
      apiEndpoints: formattedApiInfo.endpoints.length
    });

    // Initial classification
    const classificationResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge, formattedApiInfo)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      functions: [dataHubFunctions.makeRequest],
      function_call: "auto",
      temperature: 0.3
    });

    logger.debug('Received OpenAI classification response', {
      responseId: classificationResponse.id,
      model: classificationResponse.model,
      hasFunctionCall: !!classificationResponse.choices[0].message.function_call,
      responseContent: classificationResponse.choices[0].message.content
    });

    // Handle any function calls
    let customerData = null;
    if (classificationResponse.choices[0].message.function_call) {
      customerData = await handleFunctionCall(
        classificationResponse.choices[0].message.function_call,
        senderEmail
      );
    }

    // Parse classification result
    const classification = parseClassificationResponse(classificationResponse);

    // If there are images, mark as APPRAISAL_LEAD
    if (imageAttachments && imageAttachments.length > 0) {
      classification.intent = "APPRAISAL_LEAD";
      classification.requiresReply = true;
    }

    recordMetric('email_classifications', 1);
    logger.info('Email classification completed', {
      classification,
      hasCustomerData: !!customerData,
      hasImages: !!imageAttachments
    });

    return {
      classification,
      customerData,
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

function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) return '';

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}