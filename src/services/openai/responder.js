import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { agentPrompts } from './agentPrompts.js';
import { getOpenAIClient } from './client.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o';

async function getAvailableEndpoints() {
  try {
    // Make unauthenticated request to fetch endpoints
    const response = await fetch('https://data-hub-856401495068.us-central1.run.app/api/endpoints');
    if (!response.ok) {
      throw new Error(`Failed to fetch endpoints: ${response.status}`);
    }
    const data = await response.json();

    logger.info('Fetched Data Hub endpoints', {
      endpointCount: data.endpoints?.length,
      authentication: data.authentication?.type,
      rateLimiting: data.rateLimiting?.requestsPerWindow,
      timestamp: new Date().toISOString()
    });

    return data.endpoints || [];
  } catch (error) {
    logger.error('Failed to fetch endpoints:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return [];
  }
}

async function queryDataHub(endpoint, method, params = null) {
  try {
    const secrets = await getSecrets();
    if (!secrets.DATA_HUB_API_KEY) {
      throw new Error('DATA_HUB_API_KEY not found');
    }

    const url = new URL(`https://data-hub-856401495068.us-central1.run.app${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, value);
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'X-API-Key': secrets.DATA_HUB_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`DataHub request failed: ${response.status}`);
    }

    const data = await response.json();
    logger.info('DataHub query successful', {
      endpoint,
      method,
      hasParams: !!params,
      timestamp: new Date().toISOString()
    });

    return data;
  } catch (error) {
    logger.error('DataHub query failed:', {
      error: error.message,
      endpoint,
      method,
      stack: error.stack,
      timestamp: new Date().toISOString()
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
      timestamp: new Date().toISOString()
    });

    const openai = await getOpenAIClient();

    // Analyze images if present
    const imageAnalysis = imageAttachments ? 
      await analyzeImages(openai, imageAttachments, companyKnowledge) : null;

    // Get available DataHub endpoints
    const endpoints = await getAvailableEndpoints();

    // Format thread context safely
    const threadContext = threadMessages && Array.isArray(threadMessages) ? 
      formatThreadForPrompt(threadMessages) : '';

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
- Email: ${senderInfo?.email || 'Unknown'}
- Previous interactions: ${threadMessages?.length || 0}
- Message type: ${threadMessages?.length ? 'Follow-up message' : 'First contact'}

Available DataHub endpoints:
${endpoints.map(e => `- ${e.method} ${e.path}: ${e.description}`).join('\n')}

You can query these endpoints to get additional information when needed.`;

    // Generate response with function calling
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
              enum: ["GET"]
            },
            params: {
              type: "object",
              description: "Query parameters",
              properties: {
                email: {
                  type: "string",
                  description: "Customer email address"
                },
                sessionId: {
                  type: "string",
                  description: "Session ID"
                },
                wordpressSlug: {
                  type: "string",
                  description: "WordPress URL slug"
                }
              }
            }
          },
          required: ["endpoint", "method"]
        }
      }],
      function_call: "auto",
      temperature: 0.7
    });

    // Handle function calls if any
    let reply = '';
    for (const message of responseGeneration.choices) {
      if (message.message.function_call) {
        const functionCall = message.message.function_call;
        const args = JSON.parse(functionCall.arguments);

        // Execute the function call
        const result = await queryDataHub(args.endpoint, args.method, args.params);

        // Get completion with function result
        const functionResponse = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: fullContext
            },
            {
              role: "assistant",
              content: "Let me check the available information."
            },
            {
              role: "function",
              name: "queryDataHub",
              content: JSON.stringify(result)
            }
          ],
          temperature: 0.7
        });

        reply = functionResponse.choices[0].message.content;
      } else {
        reply = message.message.content;
      }
    }

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
      timestamp: new Date().toISOString()
    });
    recordMetric('response_failures', 1);
    throw error;
  }
}

async function analyzeImages(openai, imageAttachments, companyKnowledge) {
  if (!imageAttachments || !Array.isArray(imageAttachments) || imageAttachments.length === 0) {
    return null;
  }

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
      analysis,
      timestamp: new Date().toISOString()
    });

    recordMetric('image_analyses', 1);
    return analysis;
  } catch (error) {
    logger.error('Error analyzing images:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
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
  if (!threadMessages || !Array.isArray(threadMessages)) {
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