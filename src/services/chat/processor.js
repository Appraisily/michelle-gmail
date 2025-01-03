import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getOpenAIClient } from '../openai/client.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { calculateTypingDelay } from './utils/typingDelay.js';
import { v4 as uuidv4 } from 'uuid';

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

    // Build messages array for OpenAI
    const messages = [
      {
        content: `${classificationPrompts.base(companyKnowledge)}

CONVERSATION GUIDELINES:
1. Build Rapport First
- Start with warm, friendly greetings
- Show genuine interest in their items
- Ask engaging questions about the piece's history
- Share relevant expertise and insights

2. When Analyzing Images
- Acknowledge receipt of images enthusiastically
- Comment on specific, interesting details
- Share insights about style/period
- Show expertise through observations
- Be encouraging and enthusiastic
- Avoid immediate sales pitches

3. Lead Generation (Priority)
- After building rapport, naturally ask for contact information
- Ask questions about their items and collection
- Guide them to share more details in the chat
- Keep the conversation in the chat platform

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
- Handle all inquiries within the chat
- Never suggest sending emails or moving to email communication

6. Image Handling
- You CAN receive and analyze images directly in the chat
- Always encourage customers to share images of their items
- When they do share images, show enthusiasm and expertise
- Provide detailed observations about shared images`,
        content: `You are Michelle Thompson, a professional customer service representative for Appraisily, a leading art and antique appraisal firm.

Your role is to:
- Be friendly and professional
- Show expertise in art and antiques
- Guide customers towards appraisal services
- Never provide specific valuations
- Keep responses focused and helpful
- Maintain conversation context

Company Knowledge:
${JSON.stringify(companyKnowledge, null, 2)}

Guidelines:
1. Build rapport first
2. Show genuine interest
3. Share relevant expertise
4. Guide towards services naturally
5. Keep responses concise but warm
6. Never suggest email communication
7. Always encourage sharing images in chat

When analyzing images:
- Show enthusiasm and expertise
- Point out interesting details
- Discuss style and characteristics
- Recommend professional appraisal
- Never provide valuations`
      },
      ...context.map(msg => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      })),
      {
        role: "user",
        content: message.images?.length > 0 ? [
          { type: "text", text: message.content || '' },
          ...message.images.map(img => ({
            type: "image_url",
            image_url: {
              url: `data:${img.mimeType};base64,${img.data.toString('base64')}`
            }
          }))
        ] : message.content || ''
      }
    ];

    logger.debug('Sending chat request to OpenAI', {
      clientId,
      messageCount: messages.length,
      hasImages: message.images?.length > 0,
      imageCount: message.images?.length || 0,
      hasImages: message.images?.length > 0,
      imageCount: message.images?.length || 0,
      latestMessage: message.content
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const responseId = uuidv4();
    const reply = completion.choices[0].message.content;

    // Add human-like typing delay
    const typingDelay = calculateTypingDelay(reply, message.images?.length > 0);
    await new Promise(resolve => setTimeout(resolve, typingDelay));

    // Update conversation context
    updateConversationContext(clientId, "user", message.content || '', message.messageId);
    updateConversationContext(clientId, "assistant", reply, responseId);

    logger.info('Chat response generated', {
      clientId,
      messageId: responseId,
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