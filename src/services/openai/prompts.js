import { analysisPrompts } from './prompts/analysis.js';
import { responsePrompts } from './prompts/response.js';

export const systemPrompts = {
  analysis: (companyKnowledge, apiInfo = {}) => {
    const endpointsInfo = apiInfo.endpoints 
      ? apiInfo.endpoints.map(e => `${e.method} ${e.path}
Description: ${e.description}
Parameters: ${e.parameters.map(p => `\n  - ${p.name}: ${p.description}${p.required ? ' (Required)' : ''}`).join('')}
Example Response: ${JSON.stringify(e.responseExample, null, 2)}
`).join('\n\n')
      : 'No endpoints available';

    const authInfo = apiInfo.authentication
      ? `Type: ${apiInfo.authentication.type}
Header: ${apiInfo.authentication.headerName}
${apiInfo.authentication.description}`
      : 'No authentication required';

    const rateInfo = apiInfo.rateLimiting
      ? `- ${apiInfo.rateLimiting.requestsPerWindow} requests per ${apiInfo.rateLimiting.windowMinutes} minutes
- Error ${apiInfo.rateLimiting.errorCode}: ${apiInfo.rateLimiting.errorMessage}`
      : 'No rate limiting';

    return `
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
  },

  response: (responseType, urgency, companyKnowledge) => [
    responsePrompts.base(responseType, urgency, companyKnowledge),
    responsePrompts.appraisalStatus,
    responsePrompts.salesInformation
  ].join('\n\n')
};