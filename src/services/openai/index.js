import OpenAI from 'openai';
import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { getSecrets } from '../../utils/secretManager.js';
import { companyKnowledge } from '../../data/companyKnowledge.js';
import { dataHubClient } from '../dataHub/client.js';
import { emailAnalysisFunction, responseGenerationFunction } from './functions.js';
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

async function getCustomerData(senderEmail, context = {}) {
  try {
    const [pending, completed, sales] = await Promise.all([
      dataHubClient.getPendingAppraisals({ 
        email: senderEmail,
        sessionId: context.sessionId,
        wordpressSlug: context.wordpressSlug
      }),
      context.checkCompletedAppraisals ? dataHubClient.getCompletedAppraisals({ 
        email: senderEmail,
        sessionId: context.sessionId,
        wordpressSlug: context.wordpressSlug
      }) : { appraisals: [], total: 0 },
      context.stripeCustomerId ? dataHubClient.getSales({
        email: senderEmail,
        sessionId: context.sessionId,
        stripeCustomerId: context.stripeCustomerId
      }) : { sales: [], total: 0 }
    ]);
    
    return {
      appraisals: {
        hasPending: pending.appraisals.length > 0,
        hasCompleted: completed.appraisals.length > 0,
        pendingCount: pending.total,
        completedCount: completed.total,
        pendingAppraisals: pending.appraisals,
        completedAppraisals: completed.appraisals
      },
      sales: {
        hasSales: sales.sales.length > 0,
        totalSales: sales.total,
        salesData: sales.sales
      }
    };
  } catch (error) {
    logger.error('Error fetching customer data:', {
      error: error.message,
      senderEmail,
      context,
      stack: error.stack
    });
    return null;
  }
}

function formatThreadForPrompt(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) {
    return '';
  }

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      const date = new Date(msg.date).toLocaleString();
      return `[${date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}

export async function classifyAndProcessEmail(emailContent, senderEmail, threadMessages = null) {
  try {
    const openai = await getOpenAIClient();
    
    // Format thread context if available
    const threadContext = formatThreadForPrompt(threadMessages);
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;
    
    // First, analyze the email
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompts.analysis(companyKnowledge)
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${fullContext}`
        }
      ],
      functions: [emailAnalysisFunction],
      function_call: { name: "analyzeEmail" },
      temperature: 0.3
    });

    const analysis = JSON.parse(
      analysisResponse.choices[0].message.function_call.arguments
    );

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', analysis);

    // Get customer data if needed
    let customerData = null;
    if (analysis.appraisalCheck || analysis.salesCheck) {
      logger.info('Fetching customer data for:', { 
        senderEmail,
        context: analysis.context 
      });
      customerData = await getCustomerData(senderEmail, analysis.context);
    }

    if (!analysis.requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: analysis.reason,
        analysis,
        customerData
      };
    }

    // Generate response if needed
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
          content: `Full email thread:\n${fullContext}\n\nAnalysis: ${JSON.stringify(analysis)}\n\nCustomer Data: ${JSON.stringify(customerData)}\n\nGenerate an appropriate response.`
        }
      ],
      functions: [responseGenerationFunction],
      function_call: { name: "generateResponse" },
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
      responseData,
      customerData
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', error);
    recordMetric('openai_failures', 1);
    throw error;
  }
}