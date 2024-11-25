import { analysisPrompts } from './analysis.js';
import { responsePrompts } from './response.js';

export const systemPrompts = {
  analysis: (companyKnowledge) => [
    analysisPrompts.base(companyKnowledge),
    analysisPrompts.appraisalContext,
    analysisPrompts.salesContext
  ].join('\n\n'),

  response: (responseType, urgency, companyKnowledge) => [
    responsePrompts.base(responseType, urgency, companyKnowledge),
    responsePrompts.appraisalStatus,
    responsePrompts.salesInformation
  ].join('\n\n')
};