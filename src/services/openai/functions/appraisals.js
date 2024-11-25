/**
 * Functions related to appraisal data analysis and processing
 */

export const appraisalAnalysisFunction = {
  name: "analyzeAppraisalContext",
  description: "Analyzes appraisal-related context from customer data",
  parameters: {
    type: "object",
    properties: {
      checkPending: {
        type: "boolean",
        description: "Whether to check pending appraisals"
      },
      checkCompleted: {
        type: "boolean",
        description: "Whether to check completed appraisals"
      },
      filters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Specific appraisal session ID to check"
          },
          wordpressSlug: {
            type: "string",
            description: "WordPress URL slug to check"
          }
        }
      }
    },
    required: ["checkPending"]
  }
};