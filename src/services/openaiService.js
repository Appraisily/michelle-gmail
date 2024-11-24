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
      requiresReply: {
        type: "boolean",
        description: "Whether the email needs a response"
      },
      reason: {
        type: "string",
        description: "Brief explanation of why the email does or doesn't need a reply"
      }
    },
    required: ["requiresReply", "reason"]
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
        content: `Analyze this email and determine if it requires a reply:\n\n${emailContent}`
      }],
      functions: [classifyEmailFunction],
      function_call: { name: "classifyEmail" },
      temperature: 0.3,
      max_tokens: 150
    });

    const functionCall = classificationResponse.choices[0].message.function_call;
    const { requiresReply, reason } = JSON.parse(functionCall.arguments);

    logger.info('Email classification', { requiresReply, reason });
    recordMetric('email_classifications', 1);

    if (!requiresReply) {
      return { requiresReply: false, generatedReply: null, reason };
    }

    // Generate reply if needed
    const replyResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a professional email assistant. Generate concise, helpful replies that maintain a friendly yet professional tone."
        },
        {
          role: "user",
          content: `Generate a professional reply to this email:\n\n${emailContent}`
        }
      ],
      temperature: 0.7,
      max_tokens: 400
    });

    recordMetric('replies_generated', 1);

    return {
      requiresReply: true,
      generatedReply: replyResponse.choices[0].message.content,
      reason
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', error);
    recordMetric('openai_failures', 1);
    throw error;
  }
}