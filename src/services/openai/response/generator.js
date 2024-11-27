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
                email: { type: "string" },
                sessionId: { type: "string" },
                wordpressSlug: { type: "string" }
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