import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { getSecrets } from '../utils/secretManager.js';

let openaiClient = null;

async function getOpenAIClient() {
  if (!openaiClient) {
    const secrets = await getSecrets();
    openaiClient = new OpenAI({
      apiKey: secrets.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

const classifyEmailFunction = {
  name: "classifyEmail",
  description: "Determines whether an email requires a response.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The body of the email."
      }
    },
    required: ["content"]
  }
};

export async function classifyAndProcessEmail(emailContent) {
  try {
    const openai = await getOpenAIClient();
    
    // First, classify if the email needs a reply using function calling
    const classificationResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "user",
        content: `Analyze this email and determine if it requires a reply: ${emailContent}`
      }],
      functions: [classifyEmailFunction],
      function_call: { name: "classifyEmail" },
      temperature: 0.3,
      max_tokens: 60
    });

    const functionCall = classificationResponse.choices[0].message.function_call;
    const { content } = JSON.parse(functionCall.arguments);
    const requiresReply = content.toLowerCase().includes('yes');

    recordMetric('email_classifications', 1);

    if (!requiresReply) {
      return { requiresReply: false, generatedReply: null };
    }

    // Generate reply if needed
    const replyResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional email assistant. Generate concise, helpful replies."
        },
        {
          role: "user",
          content: `Generate a professional reply to this email: ${emailContent}`
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    recordMetric('replies_generated', 1);

    return {
      requiresReply: true,
      generatedReply: replyResponse.choices[0].message.content
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', error);
    recordMetric('openai_failures', 1);
    throw error;
  }
}