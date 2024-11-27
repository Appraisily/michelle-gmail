import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { agentPrompts } from './agentPrompts.js';
import { getOpenAIClient } from './client.js';
import { dataHubClient } from '../dataHub/client.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o';

async function getAvailableEndpoints() {
  try {
    const apiInfo = await dataHubClient.fetchEndpoints();
    logger.info('Fetched Data Hub endpoints', {
      endpointCount: apiInfo.endpoints?.length,
      authentication: apiInfo.authentication?.type,
      rateLimiting: apiInfo.rateLimiting?.requestsPerWindow
    });
    return apiInfo.endpoints;
  } catch (error) {
    logger.error('Failed to fetch endpoints:', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

async function queryDataHub(endpoint, method, params = null, body = null) {
  try {
    const data = await dataHubClient.makeRequest(endpoint, method, params, body);
    logger.info('Data Hub query successful', {
      endpoint,
      method,
      hasParams: !!params,
      hasBody: !!body
    });
    return data;
  } catch (error) {
    logger.error('Data Hub query failed:', {
      error: error.message,
      endpoint,
      method,
      stack: error.stack
    });
    return null;
  }
}

export async function generateResponse(
  emailContent, 
  classification, 
  customerData, 
  threadMessages = null, 
  imageAttachments = null,
  companyKnowledge,
  senderInfo = null
) {
  try {
    logger.info('Starting response generation', {
      classification: classification.intent,
      hasCustomerData: !!customerData,
      hasImages: !!imageAttachments,
      hasSenderInfo: !!senderInfo,
      senderEmail: senderInfo?.email,
      senderName: senderInfo?.name
    });

    const openai = await getOpenAIClient();

    // Analyze images if present
    const imageAnalysis = imageAttachments ? 
      await analyzeImages(openai, imageAttachments, companyKnowledge) : null;

    // Get available DataHub endpoints
    const endpoints = await getAvailableEndpoints();

    // Format thread context
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Add sender information and endpoints to system prompt
    const systemPrompt = `${agentPrompts.response(
      classification.suggestedResponseType,
      classification.urgency,
      companyKnowledge
    )}

Current sender information:
- Name: ${senderInfo?.name || 'Unknown'}
- Email: ${senderInfo?.email}
- Previous interactions: ${threadMessages?.length || 0}

Available DataHub endpoints:
${endpoints.map(e => `- ${e.method} ${e.path}: ${e.description}`).join('\n')}

You can query these endpoints to get additional information when needed.`;

    // Generate response
    const responseGeneration = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Full email thread:\n${fullContext}\n\nClassification: ${JSON.stringify(classification)}\n\nCustomer Data: ${JSON.stringify(customerData)}\n${imageAnalysis ? `\nImage Analysis: ${imageAnalysis}` : ''}\n\nGenerate an appropriate response.`
        }
      ],
      functions: [{
        name: "queryDataHub",
        description: "Query DataHub API endpoints to get additional information",
        parameters: {
          type: "object",
          properties: {
            endpoint: {
              type: "string",
              description: "The endpoint path to query"
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "DELETE"]
            },
            params: {
              type: "object",
              description: "Query parameters"
            },
            body: {
              type: "object",
              description: "Request body for POST/PUT"
            }
          },
          required: ["endpoint", "method"]
        }
      }],
      temperature: 0.7
    });

    const reply = responseGeneration.choices[0].message.content;

    // Log the complete response for monitoring
    logger.info('OpenAI response generated', {
      classification: classification.intent,
      senderEmail: senderInfo?.email,
      responseLength: reply.length,
      response: reply,
      hasImages: !!imageAttachments,
      hasThreadContext: !!threadMessages,
      timestamp: new Date().toISOString()
    });

    recordMetric('replies_generated', 1);

    return {
      generatedReply: reply,
      imageAnalysis
    };

  } catch (error) {
    logger.error('Error generating response:', {
      error: error.message,
      stack: error.stack,
      classification: classification.intent,
      senderEmail: senderInfo?.email
    });
    recordMetric('response_failures', 1);
    throw error;
  }
}

async function analyzeImages(openai, imageAttachments, companyKnowledge) {
  if (!imageAttachments || imageAttachments.length === 0) return null;

  try {
    const imageAnalysisResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: agentPrompts.imageAnalysis(companyKnowledge)
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

    const analysis = imageAnalysisResponse.choices[0].message.content;
    
    logger.info('Image analysis completed', {
      imageCount: imageAttachments.length,
      analysisLength: analysis.length,
      analysis
    });

    recordMetric('image_analyses', 1);
    return analysis;
  } catch (error) {
    logger.error('Error analyzing images:', {
      error: error.message,
      stack: error.stack
    });
    recordMetric('image_analysis_failures', 1);
    return null;
  }
}

function formatImageAttachments(imageAttachments) {
  return imageAttachments.map(img => ({
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    }
  }));
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