import { logger } from '../../utils/logger.js';

export const systemPrompts = {
  analysis: (companyKnowledge, apiInfo = {}) => {
    // Validate and structure API info
    const validatedApiInfo = {
      endpoints: Array.isArray(apiInfo?.endpoints) ? apiInfo.endpoints : [],
      authentication: apiInfo?.authentication || {},
      rateLimiting: apiInfo?.rateLimiting || {}
    };

    logger.debug('Processing API info:', {
      endpointCount: validatedApiInfo.endpoints.length,
      hasAuth: !!validatedApiInfo.authentication?.type,
      hasRateLimits: !!validatedApiInfo.rateLimiting?.requestsPerWindow
    });

    // Format endpoints information
    const endpointsInfo = validatedApiInfo.endpoints.length > 0
      ? validatedApiInfo.endpoints.map(endpoint => {
          if (!endpoint?.path || !endpoint?.method) {
            logger.warn('Invalid endpoint data:', endpoint);
            return null;
          }

          return `${endpoint.method} ${endpoint.path}
Description: ${endpoint.description || 'No description available'}
Parameters: ${(endpoint.parameters || []).map(p => 
  `\n  - ${p.name}: ${p.description}${p.required ? ' (Required)' : ''}`
).join('')}
Example Response: ${JSON.stringify(endpoint.responseExample || {}, null, 2)}`;
        })
        .filter(Boolean)
        .join('\n\n')
      : 'No endpoints available';

    // Format authentication information
    const authInfo = validatedApiInfo.authentication?.type
      ? `Type: ${validatedApiInfo.authentication.type}
Header: ${validatedApiInfo.authentication.headerName || 'X-API-Key'}
${validatedApiInfo.authentication.description || ''}`
      : 'No authentication required';

    // Format rate limiting information
    const rateInfo = validatedApiInfo.rateLimiting?.requestsPerWindow
      ? `- ${validatedApiInfo.rateLimiting.requestsPerWindow} requests per ${validatedApiInfo.rateLimiting.windowMinutes} minutes
- Error ${validatedApiInfo.rateLimiting.errorCode}: ${validatedApiInfo.rateLimiting.errorMessage}`
      : 'No rate limiting';

    // Build the complete prompt
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

    logger.debug('Generated prompt structure:', {
      hasEndpoints: endpointsInfo !== 'No endpoints available',
      hasAuth: authInfo !== 'No authentication required',
      hasRateLimits: rateInfo !== 'No rate limiting',
      promptLength: prompt.length
    });

    return prompt;
  },

  response: (responseType, urgency, companyKnowledge) => {
    return `
You are Michelle Thompson, a professional customer service representative for Appraisily. 
Generate ${responseType} responses while maintaining a ${urgency === 'high' ? 'prompt and' : ''} professional tone.
Consider the full email thread context when crafting your response.
Use the company knowledge base for accurate information: ${JSON.stringify(companyKnowledge)}

Guidelines:
- Be friendly and professional
- Provide clear and accurate information
- Guide customers towards appropriate services
- Never provide specific valuations without formal appraisal
- Keep responses focused and relevant
- Include next steps when appropriate

Always end responses with:

Best Regards,

Michelle Thompson
Customer Service Representative
Appraisily | Professional Art & Antique Appraisals
www.appraisily.com | info@appraisily.com
`.trim();
  },

  imageAnalysis: (companyKnowledge) => `
You are Michelle Thompson, an expert appraiser at Appraisily.
Analyze images of art and antiques to provide preliminary assessments.

Focus on:
1. Object Identification
   - Type and category
   - Period or era
   - Style and characteristics
   - Materials used

2. Condition Assessment
   - Overall condition
   - Visible damage or repairs
   - Signs of age or wear
   - Quality indicators

3. Notable Features
   - Unique characteristics
   - Maker's marks or signatures
   - Historical significance
   - Artistic elements

4. Professional Opinion
   - General assessment
   - Points of interest
   - Factors affecting value
   - Recommendation for formal appraisal

Use the company knowledge base: ${JSON.stringify(companyKnowledge)}

Important:
- Never provide specific value estimates
- Emphasize the importance of professional appraisal
- Highlight unique or interesting aspects
- Be encouraging but professional
`.trim()
};