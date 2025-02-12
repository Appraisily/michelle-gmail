import { logger } from '../../utils/logger.js';
import { getOpenAIClient } from '../openai/client.js';

/**
 * Analyze chat conversation to generate summary and topics
 * @param {Array} messages Chat messages
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeChatConversation(messages) {
  try {
    const openai = await getOpenAIClient();

    const prompt = `Analyze this chat conversation and provide a JSON response with:
1. A brief summary of the key points discussed
2. Main topics covered (as an array of strings)
3. Overall sentiment (positive, neutral, or negative)

Format the response exactly like this:
{
  "summary": "Brief summary of conversation",
  "topics": ["topic1", "topic2"],
  "sentiment": "positive"
}

Chat conversation:
${messages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert conversation analyzer. Provide concise, accurate analysis in the exact JSON format requested."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    logger.info('Chat conversation analyzed', {
      summaryLength: analysis.summary.length,
      topicCount: analysis.topics.length,
      sentiment: analysis.sentiment,
      timestamp: new Date().toISOString()
    });

    return analysis;
  } catch (error) {
    logger.error('Error analyzing chat conversation:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}