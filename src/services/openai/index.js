import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getSecrets } from '../../utils/secretManager.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';
import { systemPrompts } from './prompts.js';

let openaiClient = null;

async function getOpenAIClient() {
  if (!openaiClient) {
    const secrets = await getSecrets();
    openaiClient = new OpenAI({
      apiKey: secrets.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

async function getCustomerData(senderEmail) {
  try {
    logger.info('Starting customer data fetch', { senderEmail });
    
    // Get available endpoints
    const endpoints = await dataHubClient.fetchEndpoints();
    logger.info('Retrieved Data Hub endpoints', { 
      count: endpoints.length,
      paths: endpoints.map(e => e.path)
    });
    
    // Prepare API calls based on available endpoints
    const apiCalls = [];
    
    // Add calls based on available endpoints
    endpoints.forEach(endpoint => {
      if (endpoint.path === '/appraisals/pending' || 
          endpoint.path === '/appraisals/completed' ||
          endpoint.path === '/sales') {
        apiCalls.push(
          dataHubClient.makeRequest(
            endpoint.path,
            'GET',
            { email: senderEmail }
          )
        );
        logger.info('Added API call to queue', { 
          path: endpoint.path,
          method: 'GET',
          params: { email: senderEmail }
        });
      }
    });

    // Execute all API calls in parallel
    logger.info('Executing API calls', { count: apiCalls.length });
    const results = await Promise.all(apiCalls);
    
    logger.info('Customer data fetch completed', {
      resultsCount: results.length,
      dataPoints: results.map(r => ({
        type: r.type,
        count: r.total
      }))
    });

    return {
      endpoints,
      data: results
    };
  } catch (error) {
    logger.error('Error fetching customer data:', {
      error: error.message,
      senderEmail,
      stack: error.stack
    });
    return null;
  }
}

function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) {
    return '';
  }

  const formatted = threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');

  logger.info('Formatted email thread', {
    messageCount: threadMessages.length,
    firstMessageDate: threadMessages[0].date,
    lastMessageDate: threadMessages[threadMessages.length - 1].date
  });

  return formatted;
}

export async function classifyAndProcessEmail(emailContent, senderEmail, threadMessages = null) {
  try {
    logger.info('Starting email classification process', {
      senderEmail,
      hasThread: !!threadMessages,
      threadLength: threadMessages?.length
    });

    const openai = await getOpenAIClient();
    
    // Get customer data and available endpoints
    logger.info('Fetching customer context data');
    const { endpoints, data: customerData } = await getCustomerData(senderEmail);
    
    // Format thread context if available
    logger.info('Preparing email context');
    const threadContext = formatThreadForPrompt(threadMessages);
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;
    
    // First, analyze the email
    logger.info('Starting OpenAI analysis');
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge, endpoints)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      functions: [{
        name: "makeDataHubRequest",
        description: "Makes a request to Data Hub API",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "API endpoint path"
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE"]
            },
            params: {
              type: "object",
              additionalProperties: true
            }
          },
          required: ["path", "method"]
        }
      }],
      temperature: 0.3
    });

    const analysis = JSON.parse(
      analysisResponse.choices[0].message.function_call.arguments
    );

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', {
      intent: analysis.intent,
      urgency: analysis.urgency,
      requiresReply: analysis.requiresReply,
      responseType: analysis.suggestedResponseType,
      reason: analysis.reason
    });

    if (!analysis.requiresReply) {
      logger.info('No reply needed', { reason: analysis.reason });
      return {
        requiresReply: false,
        generatedReply: null,
        reason: analysis.reason,
        analysis,
        customerData
      };
    }

    // Generate response if needed
    logger.info('Starting response generation');
    const responseGeneration = await openai.chat.completions.create({
      model: "gpt-4",
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

    const responseData = JSON.parse(
      responseGeneration.choices[0].message.function_call.arguments
    );

    recordMetric('replies_generated', 1);
    logger.info('Response generated', {
      tone: responseData.tone,
      hasNextSteps: !!responseData.nextSteps,
      responseLength: responseData.response.length,
      metadata: responseData.metadata
    });

    return {
      requiresReply: true,
      generatedReply: responseData.response,
      reason: analysis.reason,
      analysis,
      responseData,
      customerData
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', {
      error: error.message,
      stack: error.stack,
      phase: error.phase || 'unknown',
      context: {
        senderEmail,
        hasThread: !!threadMessages
      }
    });
    recordMetric('openai_failures', 1);
    throw error;
  }
}