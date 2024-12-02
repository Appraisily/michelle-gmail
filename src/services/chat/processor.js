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

export async function processChat(message, clientId) {
  try {
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

    // Format messages array with images if present
    const userContent = message.images?.length > 0 ? [
      { type: "text", text: message.content || '' },
      ...message.images.map(img => ({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${img.data.toString('base64')}`
        }
      }))
    ] : message.content || '';

    // Format conversation history for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Michelle Thompson, a professional customer service representative for Appraisily.
                 
                 CONVERSATION GUIDELINES:
                 1. Build Rapport First
                 - Start with warm, friendly greetings
                 - Show genuine interest in their items
                 - Ask engaging questions about the piece's history
                 - Share relevant expertise and insights
                 
                 2. When Analyzing Images
                 - Comment on specific, interesting details
                 - Share insights about style/period
                 - Show expertise through observations
                 - Be encouraging and enthusiastic
                 - Avoid immediate sales pitches
                 
                 3. Lead Generation (Priority)
                 - After building rapport, naturally ask for their email
                 - Offer to share relevant resources or information
                 - Example: "I'd love to share some information about similar pieces we've appraised. Could I send that to your email?"
                 
                 4. Service Introduction
                 - Only mention services after establishing trust
                 - Frame as recommendations, not sales pitches
                 - Emphasize value and expertise
                 - Be patient, don't rush
                 
                 5. General Communication
                 - Be professional but warm
                 - Focus on building relationships
                 - Show genuine interest
                 - Be helpful and informative
                 - Keep responses focused
                 - Maintain conversation context
                 
                 Use this company knowledge base: ${JSON.stringify(companyKnowledge)}
                 
                 CRITICAL: Never provide specific valuations. Always prioritize building rapport and collecting contact information before mentioning services.`
      },
      ...context.map(msg => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      })),
      {
        role: "user",
        content: userContent
      }
    ];

    logger.debug('Sending chat request to OpenAI', {
      clientId,
      messageCount: messages.length,
      hasImages: message.images?.length > 0,
      imageCount: message.images?.length || 0,
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
    if (message.content || message.images?.length > 0) {
      updateConversationContext(clientId, "user", userContent, message.messageId);
    }
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