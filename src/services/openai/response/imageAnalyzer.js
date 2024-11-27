import { logger } from '../../../utils/logger.js';
import { recordMetric } from '../../../utils/monitoring.js';
import { agentPrompts } from '../agentPrompts.js';
import { formatImageAttachments } from './formatter.js';

// CRITICAL: DO NOT CHANGE THIS MODEL CONFIGURATION
const MODEL = 'gpt-4o';

export async function analyzeImages(openai, imageAttachments, companyKnowledge) {
  if (!imageAttachments || !Array.isArray(imageAttachments) || imageAttachments.length === 0) {
    return null;
  }

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

    const analysis = imageAnalysisResponse.choices[0].message.content;
    
    logger.info('Image analysis completed', {
      imageCount: imageAttachments.length,
      analysisLength: analysis.length,
      analysis,
      timestamp: new Date().toISOString()
    });

    recordMetric('image_analyses', 1);
    return analysis;
  } catch (error) {
    logger.error('Error analyzing images:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    recordMetric('image_analysis_failures', 1);
    return null;
  }
}