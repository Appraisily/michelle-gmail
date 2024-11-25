import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { getSecrets } from '../utils/secretManager.js';
import { companyKnowledge } from '../data/companyKnowledge.js';

const DATA_HUB_API = 'https://data-hub-856401495068.us-central1.run.app';
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

async function getDataHubApiKey() {
  const secrets = await getSecrets();
  if (!secrets.DATA_HUB_API_KEY) {
    throw new Error('DATA_HUB_API_KEY not found');
  }
  return secrets.DATA_HUB_API_KEY;
}

async function checkAppraisalStatus(senderEmail) {
  try {
    const apiKey = await getDataHubApiKey();
    
    const headers = {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json'
    };

    logger.info('Fetching appraisal status', { 
      email: senderEmail,
      endpoint: `${DATA_HUB_API}/api/appraisals/pending`
    });

    const response = await fetch(
      `${DATA_HUB_API}/api/appraisals/pending?email=${encodeURIComponent(senderEmail)}`,
      { headers }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    return {
      hasPending: data.appraisals.length > 0,
      pendingCount: data.appraisals.length,
      latestAppraisal: data.appraisals[0] || null,
      total: data.total
    };
  } catch (error) {
    logger.error('Error checking appraisal status:', {
      error: error.message,
      senderEmail,
      stack: error.stack
    });
    return null;
  }
}

export async function classifyAndProcessEmail(emailContent, senderEmail) {
  try {
    const openai = await getOpenAIClient();
    
    // First, analyze the email
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are Michelle Thompson, an expert customer service representative for Appraisily, a leading art and antique appraisal firm. 
                   Analyze emails to determine their intent, urgency, and whether they require a response. 
                   Pay special attention to mentions of appraisals, artwork, or status inquiries.
                   Use the company knowledge base to provide accurate information: ${JSON.stringify(companyKnowledge)}`
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${emailContent}`
        }
      ],
      functions: [{
        name: "analyzeEmail",
        description: "Analyzes an email to determine its intent, urgency, and required action",
        parameters: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              enum: ["question", "request", "information", "followup", "other"],
              description: "The primary intent of the email"
            },
            urgency: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "The urgency level of the email"
            },
            requiresReply: {
              type: "boolean",
              description: "Whether the email needs a response"
            },
            reason: {
              type: "string",
              description: "Detailed explanation of the analysis"
            },
            suggestedResponseType: {
              type: "string",
              enum: ["detailed", "brief", "confirmation", "none"],
              description: "The recommended type of response"
            },
            appraisalCheck: {
              type: "boolean",
              description: "Whether to check appraisal status for the sender"
            }
          },
          required: ["intent", "urgency", "requiresReply", "reason", "suggestedResponseType"]
        }
      }],
      function_call: { name: "analyzeEmail" },
      temperature: 0.3
    });

    const analysis = JSON.parse(
      analysisResponse.choices[0].message.function_call.arguments
    );

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', analysis);

    // Check appraisal status if needed
    let appraisalStatus = null;
    if (analysis.appraisalCheck) {
      logger.info('Checking appraisal status for:', { senderEmail });
      appraisalStatus = await checkAppraisalStatus(senderEmail);
    }

    if (!analysis.requiresReply) {
      return {
        requiresReply: false,
        generatedReply: null,
        reason: analysis.reason,
        analysis,
        appraisalStatus
      };
    }

    // Generate response if needed
    const responseGeneration = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are Michelle Thompson, a professional customer service representative for Appraisily. 
                   Generate ${analysis.suggestedResponseType} responses while maintaining a ${analysis.urgency === 'high' ? 'prompt and' : ''} professional tone.
                   Use the company knowledge base for accurate information: ${JSON.stringify(companyKnowledge)}`
        },
        {
          role: "user",
          content: `Original email:\n${emailContent}\n\nAnalysis: ${JSON.stringify(analysis)}\n\nAppraisal Status: ${JSON.stringify(appraisalStatus)}\n\nGenerate an appropriate response.`
        }
      ],
      functions: [{
        name: "generateResponse",
        description: "Generates an appropriate email response based on the analysis",
        parameters: {
          type: "object",
          properties: {
            response: {
              type: "string",
              description: "The generated email response"
            },
            tone: {
              type: "string",
              enum: ["formal", "friendly", "neutral"],
              description: "The tone used in the response"
            },
            nextSteps: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Suggested follow-up actions if any"
            }
          },
          required: ["response", "tone"]
        }
      }],
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
      appraisalStatus
    };

  } catch (error) {
    logger.error('Error in OpenAI service:', error);
    recordMetric('openai_failures', 1);
    throw error;
  }
}