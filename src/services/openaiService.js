import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { getSecrets } from '../utils/secretManager.js';
import { companyKnowledge } from '../data/companyKnowledge.js';
import jwt from 'jsonwebtoken';

let openaiClient = null;
const APPRAISERS_API = 'https://appraisers-backend-856401495068.us-central1.run.app';

async function getOpenAIClient() {
  if (!openaiClient) {
    const secrets = await getSecrets();
    openaiClient = new OpenAI({
      apiKey: secrets.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

async function generateJWT() {
  try {
    const secrets = await getSecrets();
    const jwtSecret = secrets['jwt-secret'];

    if (!jwtSecret) {
      throw new Error('JWT secret not found');
    }

    // Generate a new JWT token with the exact format expected by the Appraisers API
    const token = jwt.sign(
      {
        service: 'michelle-gmail',
        type: 'service-account',
        projectId: process.env.PROJECT_ID,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiration
      },
      jwtSecret,
      {
        algorithm: 'HS256',
        noTimestamp: false
      }
    );

    return token;
  } catch (error) {
    logger.error('Error generating JWT:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function makeApiRequest(endpoint, method = 'GET', body = null) {
  try {
    const token = await generateJWT();

    if (!token) {
      throw new Error('Failed to generate JWT token');
    }

    logger.info('Generated JWT token for API request');

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Service-Name': 'michelle-gmail'
    };

    const options = {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    };

    logger.info(`Making API request to ${endpoint}`, { 
      method,
      headers: {
        ...headers,
        'Authorization': 'Bearer [REDACTED]'
      }
    });

    const response = await fetch(`${APPRAISERS_API}${endpoint}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('API request failed:', {
      endpoint,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Rest of the file remains unchanged
const systemPrompt = `You are a customer support agent for ${companyKnowledge.companyOverview.name}, a leading art and antique appraisal firm with ${companyKnowledge.companyOverview.experience} of experience. 

Key company information:
- Founded in ${companyKnowledge.companyOverview.founded}
- ${companyKnowledge.companyOverview.experts} certified experts
- Over ${companyKnowledge.companyOverview.completedAppraisals} appraisals completed
- Operating in ${companyKnowledge.companyOverview.countries} countries
- ${companyKnowledge.companyOverview.rating} rating from ${companyKnowledge.companyOverview.reviews} reviews

Services:
1. Regular Appraisal ($${companyKnowledge.services.regularAppraisal.price})
2. Insurance Appraisal ($${companyKnowledge.services.insuranceAppraisal.price})
3. Tax Deduction Appraisal ($${companyKnowledge.services.taxDeductionAppraisal.price})

Your role is to:
1. Provide accurate information about our services
2. Help with appraisal-related queries
3. Maintain a professional yet friendly tone
4. Use company knowledge to provide detailed responses
5. Direct technical issues to ${companyKnowledge.contact.technical.email}
6. Escalate complex appraisal questions to our experts

Always verify if the customer has a pending appraisal before providing general information.`;

const appraisalFunctions = [
  {
    name: "getPendingAppraisals",
    description: "Retrieves a list of all pending appraisals",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "getCompletedAppraisals",
    description: "Retrieves a list of all completed appraisals",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "getAppraisalDetails",
    description: "Retrieves detailed information about a specific appraisal",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The row ID of the appraisal in the spreadsheet"
        }
      },
      required: ["id"]
    }
  }
];

const emailFunctions = [
  {
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
  },
  {
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
  }
];

async function checkAppraisalStatus(senderEmail) {
  try {
    logger.info('Checking appraisal status for:', { senderEmail });

    const [pending, completed] = await Promise.all([
      makeApiRequest('/api/appraisals'),
      makeApiRequest('/api/appraisals/completed')
    ]);

    const pendingForSender = pending.filter(a => a.customerEmail === senderEmail);
    const completedForSender = completed.filter(a => a.customerEmail === senderEmail);

    let latestDetails = null;
    if (pendingForSender.length > 0) {
      const latest = pendingForSender[0];
      latestDetails = await makeApiRequest(`/api/appraisals/${latest.id}/list`);
    }

    const status = {
      hasPending: pendingForSender.length > 0,
      hasCompleted: completedForSender.length > 0,
      pendingCount: pendingForSender.length,
      completedCount: completedForSender.length,
      latestAppraisal: latestDetails
    };

    logger.info('Appraisal status retrieved:', status);
    return status;
  } catch (error) {
    logger.error('Error checking appraisal status:', {
      senderEmail,
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

export async function classifyAndProcessEmail(emailContent, senderEmail) {
  try {
    const openai = await getOpenAIClient();
    
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Analyze this email thoroughly:\n\n${emailContent}`
        }
      ],
      functions: [emailFunctions[0]],
      function_call: { name: "analyzeEmail" },
      temperature: 0.3
    });

    const analysis = JSON.parse(
      analysisResponse.choices[0].message.function_call.arguments
    );

    recordMetric('email_classifications', 1);
    logger.info('Email analysis completed', analysis);

    let appraisalStatus = null;
    if (analysis.appraisalCheck) {
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

    const responseGeneration = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Original email:\n${emailContent}\n\nAnalysis: ${JSON.stringify(analysis)}\n\nAppraisal Status: ${JSON.stringify(appraisalStatus)}\n\nGenerate an appropriate response.`
        }
      ],
      functions: [emailFunctions[1]],
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