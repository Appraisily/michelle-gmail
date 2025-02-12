import { logger } from '../../../utils/logger.js';
import { logChatConversation as logToSheets } from '../../sheets/index.js';
import { analyzeChatConversation } from '../analyzer.js';
import { crmPublisher } from '../../pubsub/index.js';

export async function logChatSession(client, reason = 'disconnect') {
  if (!client.messages?.length) {
    logger.debug('No messages to log', {
      clientId: client.id,
      conversationId: client.conversationId
    });
    return;
  }

  try {
    const now = new Date();
    const timestamp = now.toISOString();
    const duration = Math.floor((Date.now() - client.connectedAt) / 1000);

    // Log to sheets
    await logToSheets({
      timestamp,
      clientId: client.id,
      conversationId: client.conversationId,
      duration,
      messageCount: client.messages.length,
      imageCount: client.imageCount || 0,
      hasImages: (client.imageCount || 0) > 0,
      conversation: client.messages,
      disconnectReason: reason,
      metadata: {
        type: 'CHAT_SESSION',
        urgency: 'medium',
        labels: `chat,${reason}`
      }
    });

    // Analyze conversation
    const analysis = await analyzeChatConversation(client.messages);

    // Prepare and publish CRM message
    const crmMessage = {
      sessionId: client.conversationId,
      customer: {
        email: client.email || "anonymous"
      },
      chat: {
        sessionId: uuidv4(),
        startedAt: new Date(client.connectedAt).toISOString(),
        endedAt: timestamp,
        messageCount: client.messages.length,
        satisfactionScore: 5, // Default score
        summary: analysis.summary,
        topics: analysis.topics,
        sentiment: analysis.sentiment
      },
      metadata: {
        origin: "web-chat",
        agentId: "michelle-bot",
        timestamp: Date.now().toString()
      }
    };

    await crmPublisher.publish(crmMessage);

    logger.info('Chat session logged successfully', {
      clientId: client.id,
      conversationId: client.conversationId,
      messageCount: client.messages.length,
      analysis: {
        topics: analysis.topics,
        sentiment: analysis.sentiment
      },
      timestamp,
      duration
    });
  } catch (error) {
    logger.error('Failed to log chat session:', {
      error: error.message,
      clientId: client.id,
      stack: error.stack,
      timestamp
    });
  }
}