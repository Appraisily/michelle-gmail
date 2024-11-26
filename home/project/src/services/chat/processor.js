import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getOpenAIClient } from '../openai/client.js';
import { v4 as uuidv4 } from 'uuid';
import { companyKnowledge } from '../../data/companyKnowledge.js';

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

function updateConversationContext(clientId, role, content) {
  const context = getConversationContext(clientId);
  context.push({ role, content, timestamp: new Date().toISOString() });
  
  // Keep only last 10 messages for context
  if (context.length > 10) {
    context.shift();
  }
}

async function processWithRetry(message, clientId, retryCount = 0) {
  try {
    const openai = await getOpenAIClient();
    const context = getConversationContext(clientId);

    // Format conversation history for OpenAI
    const messages = [
      {
        role: "system",
        content: `You are Michelle Thompson, a professional customer service representative for Appraisily, a leading art and antique appraisal firm.
                 Use this company knowledge base: ${JSON.stringify(companyKnowledge)}
                 
                 Guidelines:
                 - Be friendly and professional
                 - Ask clarifying questions when needed
                 - Provide accurate information about our services
                 - Guide customers towards appropriate appraisal services
                 - Never provide specific valuations in chat
                 - Maintain conversation context
                 - Keep responses concise but helpful`
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
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = completion.choices[0].message.content;

    // Update conversation context
    updateConversationContext(clientId, "user", message.content);
    updateConversationContext(clientId, "assistant", reply);

    logger.info('Chat response generated', {
      clientId,
      messageId: message.id || uuidv4(),
      contextLength: context.length
    });

    recordMetric('chat_responses_generated', 1);

    return {
      messageId: message.id || uuidv4(),
      reply,
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

export async function classifyAndProcessChat(message, clientId) {
  try {
    logger.info('Processing chat message', {
      clientId,
      messageType: message.type,
      hasContent: !!message.content
    });

    // Handle ping messages
    if (message.type === 'ping') {
      return {
        type: 'pong',
        timestamp: new Date().toISOString()
      };
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