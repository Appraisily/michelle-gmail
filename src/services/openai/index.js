import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getSecrets } from '../../utils/secretManager.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';
import { dataHubFunctions } from './functions.js';
import { systemPrompts } from './prompts.js';

let openaiClient = null;

// CRITICAL: DO NOT CHANGE THESE MODEL CONFIGURATIONS
const MODELS = {
  // GPT-4-mini optimized for quick, accurate email classification
  CLASSIFICATION: 'gpt-4o-mini',
  // GPT-4 optimized for natural, contextual response generation and image analysis
  RESPONSE: 'gpt-4o'
};

async function getOpenAIClient() {
  if (!openaiClient) {
    const secrets = await getSecrets();
    openaiClient = new OpenAI({
      apiKey: secrets.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

async function handleFunctionCall(functionCall, senderEmail) {
  try {
    const { name, arguments: args } = functionCall;
    const parsedArgs = JSON.parse(args);

    logger.info('Handling function call', {
      function: name,
      args: parsedArgs
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
    logger.error('Error handling function call:', error);
    return null;
  }
}

function parseOpenAIResponse(response) {
  try {
    if (!response.choices?.[0]?.message?.content) {
      return {
        requiresReply: true,
        intent: "unknown",
        urgency: "medium",
        reason: "Unable to parse analysis",
        suggestedResponseType: "detailed"
      };
    }

    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
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
    logger.error('Error parsing OpenAI response:', error);
    return {
      requiresReply: true,
      intent: "unknown",
      urgency: "medium",
      reason: "Error parsing response",
      suggestedResponseType: "detailed"
    };
  }
}

function formatImageAttachments(imageAttachments) {
  if (!imageAttachments || imageAttachments.length === 0) return [];

  return imageAttachments.map(img => ({
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    }
  }));
}

export async function classifyAndProcessEmail(emailContent, senderEmail, threadMessages = null, imageAttachments = null) {
  try {
    logger.info('Starting email classification process', {
      hasThread: !!threadMessages,
      senderEmail,
      threadLength: threadMessages?.length,
      hasImages: imageAttachments?.length || 0
    });

    const openai = await getOpenAIClient();
    
    // Get available endpoints
    const apiInfo = await dataHubClient.fetchEndpoints();
    
    // Format thread context if available
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Initial classification with GPT-4o-mini
    const classificationResponse = await openai.chat.completions.create({
      model: MODELS.CLASSIFICATION,
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge, apiInfo)
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

    // Handle any function calls from classification
    let customerData = null;
    if (classificationResponse.choices[0].message.function_call) {
      customerData = await handleFunctionCall(
        classificationResponse.choices[0].message.function_call,
        senderEmail
      );
    }

    // Get the classification result
    const classification = parseOpenAIResponse(classificationResponse);

    // If there are images, perform additional analysis with GPT-4o
    let imageAnalysis = null;
    if (imageAttachments && imageAttachments.length > 0) {
      const imageAnalysisResponse = await openai.chat.completions.create({
        model: MODELS.RESPONSE, // Using GPT-4o for image analysis
        messages: [
          {
            role: "system",
            content: systemPrompts.imageAnalysis(companyKnowledge)
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze these images of potential items for appraisal:" },
              ...formatImageAttachments(imageAttachments)
            ]
          }
        ],
        temperature: 0.7
      });

      imageAnalysis = imageAnalysisResponse.choices[0].message.content;
      classification.intent = "APPRAISAL_LEAD";
      classification.requiresReply = true;
    }

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', {
      classification,
      hasCustomerData: !!customerData,
      hasImages: !!imageAttachments,
      hasImageAnalysis: !!imageAnalysis
    });

    if (!classification.requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: classification.reason,
        classification,
        customerData
      };
    }

    // Generate response using GPT-4o
    const responseGeneration = await openai.chat.completions.create({
      model: MODELS.RESPONSE,
      messages: [
        {
          role: "system",
          content: systemPrompts.response(
            classification.suggestedResponseType,
            classification.urgency,
            companyKnowledge,
            imageAnalysis
          )
        },
        {
          role: "user",
          content: `Full email thread:\n${fullContext}\n\nClassification: ${JSON.stringify(classification)}\n\nCustomer Data: ${JSON.stringify(customerData)}\n${imageAnalysis ? `\nImage Analysis: ${imageAnalysis}` : ''}\n\nGenerate an appropriate response.`
        }
      ],
      temperature: 0.7
    });

    const responseContent = responseGeneration.choices[0].message.content;
    
    recordMetric('replies_generated', 1);
    if (imageAnalysis) {
      recordMetric('image_analyses', 1);
    }

    return {
      requiresReply: true,
      generatedReply: responseContent,
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
      },
      phase: error.phase || 'unknown'
    });
    recordMetric('openai_failures', 1);
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