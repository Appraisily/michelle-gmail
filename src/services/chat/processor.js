import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getOpenAIClient } from '../openai/client.js';
import { v4 as uuidv4 } from 'uuid';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MAX_CONTEXT_LENGTH = 2000;

// Store conversation contexts
const conversationContexts = new Map();

function truncateContext(context) {
  if (!context || context.length <= MAX_CONTEXT_LENGTH) {
    return context;
  }
  return context.slice(context.length - MAX_CONTEXT_LENGTH);
}

function getConversationContext(clientId) {
  if (!conversationContexts.has(clientId)) {
    conversationContexts.set(clientId, []);
  }
  return conversationContexts.get(clientId);
}

function updateConversationContext(clientId, role, content, messageId) {
  const context = getConversationContext(clientId);
  context.push({ 
    role, 
    content, 
    messageId,
    timestamp: new Date().toISOString() 
  });
  
  // Keep only last 10 messages for context
  if (context.length > 10) {
    context.shift();
  }
}

export async function processImages(images) {
  try {
    const openai = await getOpenAIClient();
    
    // Debug log the incoming images
    logger.debug('Processing images', {
      imageCount: images.length,
      images: images.map(img => ({
        mimeType: img.mimeType,
        dataLength: img.data?.length,
        dataPreview: img.data?.slice(0, 100),
        isBase64: typeof img.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(img.data)
      }))
    });

    // Format images for OpenAI
    const formattedImages = images.map(img => {
      // Ensure data is base64 if it's a Buffer
      const base64Data = Buffer.isBuffer(img.data) ? 
        img.data.toString('base64') : 
        img.data;

      // Debug log each formatted image
      logger.debug('Formatting image for OpenAI', {
        mimeType: img.mimeType,
        base64Length: base64Data.length,
        base64Preview: base64Data.slice(0, 100),
        dataUrl: `data:${img.mimeType};base64,${base64Data.slice(0, 20)}...`
      });

      return {
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${base64Data}`
        }
      };
    });
    
    const imageAnalysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert art and antiques appraiser. Analyze the provided images and provide detailed observations.
                   Use this company knowledge base: ${JSON.stringify(companyKnowledge)}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze these images of potential items for appraisal:" },
            ...formattedImages
          ]
        }
      ],
      temperature: 0.7
    });

    const analysis = imageAnalysisResponse.choices[0].message.content;
    
    logger.info('Image analysis completed', {
      imageCount: images.length,
      analysisLength: analysis.length,
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
    throw error;
  }
}

export async function processChat(message, clientId) {
  try {
    // Skip processing for non-chat messages
    if (!message.content) {
      return null;
    }

    // Process chat message
    return await processWithRetry(message, clientId);

  } catch (error) {
    logger.error('Error in chat processor:', {
      error: error.message,
      stack: error.stack,
      clientId
    });

    recordMetric('chat_processing_errors', 1);
    throw error;
  }
}

async function processWithRetry(message, clientId, retryCount = 0) {
  try {
    const openai = await getOpenAIClient();
    const context = getConversationContext(clientId);

    // Get available DataHub endpoints
    const endpoints = await dataHubClient.fetchEndpoints();

    // Format conversation history for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Michelle Thompson, a professional customer service representative for Appraisily.
                 Use this company knowledge base: ${JSON.stringify(companyKnowledge)}
                 
                 You have access to our DataHub API through the queryDataHub function.
                 Available endpoints:
                 - GET /api/appraisals/pending - Check pending appraisals
                 - GET /api/appraisals/completed - Check completed appraisals
                 - GET /api/sales - Check sales history
                 
                 Guidelines:
                 - Be friendly and professional
                 - Ask clarifying questions when needed
                 - Provide accurate information about our services
                 - Guide customers towards appropriate services
                 - Never provide specific valuations in chat
                 - Maintain conversation context
                 - Keep responses concise but helpful
                 - Check customer records when asked about appraisals or orders`
      },
      ...context.map(msg => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      })),
      {
        role: "user",
        content: message.content
      }
    ];

    logger.debug('Sending chat request to OpenAI', {
      clientId,
      messageCount: messages.length,
      latestMessage: message.content
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
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
      temperature: 0.7,
      max_tokens: 500
    });

    let reply = '';
    const responseId = uuidv4();

    // Handle potential function calls
    if (completion.choices[0].message.function_call) {
      const functionCall = completion.choices[0].message.function_call;
      const args = JSON.parse(functionCall.arguments);

      logger.info('DataHub query requested', {
        endpoint: args.endpoint,
        method: args.method,
        params: args.params,
        timestamp: new Date().toISOString()
      });

      try {
        const customerInfo = await dataHubClient.makeRequest(
          args.endpoint,
          args.method,
          args.params
        );

        // Get completion with function result
        const functionResponse = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            ...messages,
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
          model: "gpt-4o",
          messages: [
            ...messages,
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
      reply = completion.choices[0].message.content;
    }

    // Update conversation context
    updateConversationContext(clientId, "user", message.content, message.messageId);
    updateConversationContext(clientId, "assistant", reply, responseId);

    logger.info('Chat response generated', {
      clientId,
      messageId: responseId,
      replyTo: message.messageId,
      contextLength: context.length,
      timestamp: new Date().toISOString()
    });

    recordMetric('chat_responses_generated', 1);

    return {
      messageId: responseId,
      content: reply,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn('Retrying chat processing', {
        clientId,
        retryCount,
        error: error.message
      });

      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return processWithRetry(message, clientId, retryCount + 1);
    }

    logger.error('Chat processing failed after retries', {
      error: error.message,
      stack: error.stack,
      clientId,
      retryCount
    });

    recordMetric('chat_processing_errors', 1);
    throw error;
  }
}

// Clean up old conversations periodically
setInterval(() => {
  const now = Date.now();
  for (const [clientId, context] of conversationContexts.entries()) {
    const lastMessage = context[context.length - 1];
    if (lastMessage && now - new Date(lastMessage.timestamp).getTime() > 30 * 60 * 1000) { // 30 minutes
      conversationContexts.delete(clientId);
      logger.info('Cleaned up inactive conversation', { clientId });
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes