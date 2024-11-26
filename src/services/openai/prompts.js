import { logger } from '../../utils/logger.js';
import { analysisPrompts } from './prompts/analysis.js';
import { responsePrompts } from './prompts/response.js';

export const systemPrompts = {
  analysis: (companyKnowledge, apiInfo = {}) => {
    // Debug log the raw input
    logger.debug('Raw input data:', {
      apiInfo,
      companyKnowledge
    });

    // Debug log the endpoints specifically
    logger.debug('API Endpoints data:', {
      endpoints: apiInfo?.endpoints,
      isArray: Array.isArray(apiInfo?.endpoints),
      length: apiInfo?.endpoints?.length,
      firstEndpoint: apiInfo?.endpoints?.[0]
    });

    const endpointsInfo = apiInfo?.endpoints 
      ? apiInfo.endpoints.map(e => {
          // Debug log each endpoint being processed
          logger.debug('Processing endpoint:', e);
          
          return `${e.method} ${e.path}
Description: ${e.description}
Parameters: ${e.parameters.map(p => `\n  - ${p.name}: ${p.description}${p.required ? ' (Required)' : ''}`).join('')}
Example Response: ${JSON.stringify(e.responseExample, null, 2)}
`
        }).join('\n\n')
      : 'No endpoints available';

    const authInfo = apiInfo?.authentication
      ? `Type: ${apiInfo.authentication.type}
Header: ${apiInfo.authentication.headerName}
${apiInfo.authentication.description}`
      : 'No authentication required';

    const rateInfo = apiInfo?.rateLimiting
      ? `- ${apiInfo.rateLimiting.requestsPerWindow} requests per ${apiInfo.rateLimiting.windowMinutes} minutes
- Error ${apiInfo.rateLimiting.errorCode}: ${apiInfo.rateLimiting.errorMessage}`
      : 'No rate limiting';

    const prompt = `
You are Michelle Thompson, an expert customer service representative for Appraisily.
You have access to the following Data Hub API endpoints:

${endpointsInfo}

API Authentication:
${authInfo}

Rate Limiting:
${rateInfo}

Use these endpoints to fetch customer information when needed.
Analyze emails to determine intent, urgency, and required actions.
Consider the full email thread context when available.
Use the company knowledge base: ${JSON.stringify(companyKnowledge)}
`.trim();

    // Debug log the final prompt
    logger.debug('Generated analysis prompt', {
      promptLength: prompt.length,
      hasEndpoints: endpointsInfo !== 'No endpoints available',
      hasAuth: authInfo !== 'No authentication required',
      hasRateLimits: rateInfo !== 'No rate limiting'
    });

    return prompt;
  },

  response: (responseType, urgency, companyKnowledge) => {
    logger.debug('Building response prompt with', {
      responseType,
      urgency,
      hasCompanyKnowledge: !!companyKnowledge
    });

    return [
      responsePrompts.base(responseType, urgency, companyKnowledge),
      responsePrompts.appraisalStatus,
      responsePrompts.salesInformation
    ].join('\n\n');
  }
};