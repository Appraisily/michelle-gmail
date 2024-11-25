export const emailAnalysisFunction = {
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
      },
      salesCheck: {
        type: "boolean",
        description: "Whether to check sales information for the sender"
      },
      context: {
        type: "object",
        properties: {
          checkCompletedAppraisals: {
            type: "boolean",
            description: "Whether to check completed appraisals"
          },
          sessionId: {
            type: "string",
            description: "Specific appraisal or sale session ID to check"
          },
          wordpressSlug: {
            type: "string",
            description: "WordPress URL slug to check"
          },
          stripeCustomerId: {
            type: "string",
            description: "Stripe customer ID to check"
          }
        }
      }
    },
    required: ["intent", "urgency", "requiresReply", "reason", "suggestedResponseType"]
  }
};

export const responseGenerationFunction = {
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
};