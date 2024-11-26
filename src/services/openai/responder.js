import { logger } from '../../utils/logger.js';
import { recordMetric } from '../../utils/monitoring.js';
import { agentPrompts } from './agentPrompts.js';
import { getOpenAIClient } from './client.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o';

function formatImageAttachments(imageAttachments) {
  if (!imageAttachments || imageAttachments.length === 0) return [];

  return imageAttachments.map(img => ({
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
    }
  }));
}

async function analyzeImages(openai, imageAttachments, companyKnowledge) {
  if (!imageAttachments || imageAttachments.length === 0) return null;

  try {
    const imageAnalysisResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: agentPrompts.imageAnalysis(companyKnowledge)
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze these images of potential items for appraisal:" },
            ...formatImageAttachments(imageAttachments)
          ]
        }
      ],
      temperature: 0.7
    });

    recordMetric('image_analyses', 1);
    return imageAnalysisResponse.choices[0].message.content;
  } catch (error) {
    logger.error('Error analyzing images:', error);
    recordMetric('image_analysis_failures', 1);
    return null;
  }
}

export async function generateResponse(
  emailContent, 
  classification, 
  customerData, 
  threadMessages = null, 
  imageAttachments = null,
  companyKnowledge
) {
  try {
    logger.info('Starting response generation', {
      classification: classification.intent,
      hasCustomerData: !!customerData,
      hasImages: !!imageAttachments
    });

    const openai = await getOpenAIClient();

    // Analyze images if present
    const imageAnalysis = await analyzeImages(openai, imageAttachments, companyKnowledge);

    // Format thread context
    const threadContext = threadMessages ? formatThreadForPrompt(threadMessages) : '';
    const fullContext = threadContext 
      ? `Previous messages in thread:\n\n${threadContext}\n\nLatest message:\n${emailContent}`
      : emailContent;

    // Generate response
    const responseGeneration = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: agentPrompts.response(
            classification.suggestedResponseType,
            classification.urgency,
            companyKnowledge
          )
        },
        {
          role: "user",
          content: `Full email thread:\n${fullContext}\n\nClassification: ${JSON.stringify(classification)}\n\nCustomer Data: ${JSON.stringify(customerData)}\n${imageAnalysis ? `\nImage Analysis: ${imageAnalysis}` : ''}\n\nGenerate an appropriate response.`
        }
      ],
      temperature: 0.7
    });

    recordMetric('replies_generated', 1);

    return {
      generatedReply: responseGeneration.choices[0].message.content,
      imageAnalysis
    };

  } catch (error) {
    logger.error('Error generating response:', {
      error: error.message,
      stack: error.stack,
      classification: classification.intent
    });
    recordMetric('response_failures', 1);
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