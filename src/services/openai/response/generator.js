import { logger } from '../../../utils/logger.js';
import { recordMetric } from '../../../utils/monitoring.js';
import { getOpenAIClient } from '../client.js';
import { analyzeImages } from './imageAnalyzer.js';
import { getAvailableEndpoints, queryDataHub } from './datahub.js';
import { formatThreadForPrompt } from './formatter.js';
import { buildSystemPrompt } from './prompts.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o';

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

    // Build system prompt with all context
    const systemPrompt = buildSystemPrompt({
      classification,
      companyKnowledge,
      senderInfo,
      threadMessages,
      endpoints
    });

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
        description: "Query DataHub API endpoints to get customer information",
        parameters: {
          type: "object",
          properties: {
            endpoint: {
              type: "string",
              description: "The endpoint path to query (e.g., /api/appraisals/pending)"
            },
            method: {
              type: "string",
              enum: ["GET"],
              description: "HTTP method to use"
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
                  description: "Session ID for specific queries"
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

    // Handle function calls and generate final response
    let customerInfo = null;
    let reply = '';

    for (const choice of responseGeneration.choices) {
      const message = choice.message;

      if (message.function_call) {
        const functionCall = message.function_call;
        const args = JSON.parse(functionCall.arguments);

        logger.info('DataHub query requested', {
          endpoint: args.endpoint,
          method: args.method,
          params: args.params,
          timestamp: new Date().toISOString()
        });

        // Execute the function call
        try {
          customerInfo = await queryDataHub(args.endpoint, args.method, args.params);

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
                content: "Let me check your records."
              },
              {
                role: "function",
                name: "queryDataHub",
                content: JSON.stringify(customerInfo)
              }
            ],
            temperature: 0.7
          });

          reply = functionResponse.choices[0].message.content;
        } catch (error) {
          logger.error('Error querying DataHub:', {
            error: error.message,
            endpoint: args.endpoint,
            stack: error.stack,
            timestamp: new Date().toISOString()
          });

          // Generate response acknowledging the error
          const errorResponse = await openai.chat.completions.create({
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
                content: "I encountered an error while trying to access your records."
              }
            ],
            temperature: 0.7
          });

          reply = errorResponse.choices[0].message.content;
        }
      } else {
        reply = message.content;
      }
    }

    // Log the complete response for monitoring
    logger.info('OpenAI response generated', {
      classification: classification.intent,
      senderEmail: senderInfo?.email,
      responseLength: reply.length,
      hasCustomerInfo: !!customerInfo,
      hasImages: !!imageAttachments,
      hasThreadContext: !!threadMessages,
      timestamp: new Date().toISOString()
    });

    recordMetric('replies_generated', 1);

    return {
      generatedReply: reply,
      imageAnalysis,
      customerInfo
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