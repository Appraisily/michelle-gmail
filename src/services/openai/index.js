import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getSecrets } from '../../utils/secretManager.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';
import { dataHubFunctions } from './functions.js';
import { systemPrompts } from './prompts.js';

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

export async function classifyAndProcessEmail(emailContent, senderEmail, threadMessages = null) {
  try {
    logger.info('Starting email classification process', {
      hasThread: !!threadMessages,
      senderEmail,
      threadLength: threadMessages?.length
    });

    const openai = await getOpenAIClient();
    
    // First, get available endpoints
    const apiInfo = await dataHubClient.fetchEndpoints();
    
    // Format thread context if available
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Analyze the email
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge, apiInfo)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      functions: [dataHubFunctions.makeRequest],
      function_call: "auto",
      temperature: 0.3
    });

    const analysis = JSON.parse(
      analysisResponse.choices[0].message.function_call.arguments
    );

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', analysis);

    if (!analysis.requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: analysis.reason,
        analysis
      };
    }

    // Generate response
    const responseGeneration = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompts.response(
            analysis.suggestedResponseType,
            analysis.urgency,
            companyKnowledge
          )
        },
        {
          role: "user",
          content: `Full email thread:\n${fullContext}\n\nAnalysis: ${JSON.stringify(analysis)}\n\nGenerate an appropriate response.`
        }
      ],
      functions: [dataHubFunctions.makeRequest],
      function_call: "auto",
      temperature: 0.7
    });

    const responseData = JSON.parse(
      responseGeneration.choices[0].message.function_call.arguments
    );

    recordMetric('replies_generated', 1);

    return {
      requiresReply: true,
      generatedReply: responseData.response,
      reason: analysis.reason,
      analysis,
      responseData
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', error);
    recordMetric('openai_failures', 1);
    throw error;
  }
}

function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) return '';

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}