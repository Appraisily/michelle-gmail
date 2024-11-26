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
// These specific models are required for optimal performance
const MODELS = {
  // GPT-4-mini optimized for quick, accurate email classification
  CLASSIFICATION: 'gpt-4o-mini',
  // GPT-4 optimized for natural, contextual response generation
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

    // Try to parse as JSON first
    try {
      return JSON.parse(response.choices[0].message.content);
    } catch (e) {
      // If not JSON, create a structured response
      const content = response.choices[0].message.content;
      return {
        requiresReply: content.toLowerCase().includes('requires reply') || content.toLowerCase().includes('needs response'),
        intent: "unknown",
        urgency: "medium",
        reason: content.slice(0, 200), // First 200 chars as reason
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

    // Prepare messages array with text and images
    const messages = [
      {
        role: "system",
        content: systemPrompts.analysis(companyKnowledge, apiInfo)
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Analyze this email thoroughly:\n\n${fullContext}` },
          ...(imageAttachments ? formatImageAttachments(imageAttachments) : [])
        ]
      }
    ];

    // Analyze the email using GPT-4-mini for quick classification
    const analysisResponse = await openai.chat.completions.create({
      model: MODELS.CLASSIFICATION,
      messages,
      functions: [dataHubFunctions.makeRequest],
      function_call: "auto",
      temperature: 0.3
    });

    // Handle any function calls from analysis
    let customerData = null;
    if (analysisResponse.choices[0].message.function_call) {
      customerData = await handleFunctionCall(
        analysisResponse.choices[0].message.function_call,
        senderEmail
      );
    }

    // Get the analysis result
    const analysis = parseOpenAIResponse(analysisResponse);

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', {
      analysis,
      hasCustomerData: !!customerData,
      hasImages: !!imageAttachments
    });

    if (!analysis.requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: analysis.reason,
        analysis,
        customerData
      };
    }

    // Generate response using GPT-4 optimized for natural language
    const responseGeneration = await openai.chat.completions.create({
      model: MODELS.RESPONSE,
      messages: [
        {
          role: "system",
          content: systemPrompts.response(
            analysis.suggestedResponseType,
            analysis.urgency,
            companyKnowledge
          )
        },
        {
          role: "user",
          content: `Full email thread:\n${fullContext}\n\nAnalysis: ${JSON.stringify(analysis)}\n\nCustomer Data: ${JSON.stringify(customerData)}\n\nGenerate an appropriate response.`
        }
      ],
      temperature: 0.7
    });

    const responseContent = responseGeneration.choices[0].message.content;
    
    // Handle any function calls from response generation
    if (responseGeneration.choices[0].message.function_call) {
      await handleFunctionCall(
        responseGeneration.choices[0].message.function_call,
        senderEmail
      );
    }

    recordMetric('replies_generated', 1);

    return {
      requiresReply: true,
      generatedReply: responseContent,
      reason: analysis.reason,
      analysis,
      customerData
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