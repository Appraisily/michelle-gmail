import { analysisPrompts } from './prompts/analysis.js';
import { responsePrompts } from './prompts/response.js';

export const systemPrompts = {
  analysis: (companyKnowledge, apiInfo) => `
You are Michelle Thompson, an expert customer service representative for Appraisily.
You have access to the following Data Hub API endpoints:

${apiInfo.endpoints.map(e => `${e.method} ${e.path}
Description: ${e.description}
Parameters: ${e.parameters.map(p => `\n  - ${p.name}: ${p.description}${p.required ? ' (Required)' : ''}`).join('')}
Example Response: ${JSON.stringify(e.responseExample, null, 2)}
`).join('\n\n')}

API Authentication:
${apiInfo.authentication ? `Type: ${apiInfo.authentication.type}
Header: ${apiInfo.authentication.headerName}
${apiInfo.authentication.description}` : 'No authentication required'}

Rate Limiting:
${apiInfo.rateLimiting ? `- ${apiInfo.rateLimiting.requestsPerWindow} requests per ${apiInfo.rateLimiting.windowMinutes} minutes
- Error ${apiInfo.rateLimiting.errorCode}: ${apiInfo.rateLimiting.errorMessage}` : 'No rate limiting'}

Use these endpoints to fetch customer information when needed.
Analyze emails to determine intent, urgency, and required actions.
Consider the full email thread context when available.
Use the company knowledge base: ${JSON.stringify(companyKnowledge)}
`.trim(),

  response: (responseType, urgency, companyKnowledge) => [
    responsePrompts.base(responseType, urgency, companyKnowledge),
    responsePrompts.appraisalStatus,
    responsePrompts.salesInformation
  ].join('\n\n')
};