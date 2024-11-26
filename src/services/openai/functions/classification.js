export const emailClassificationFunction = {
  name: "classifyEmail",
  description: "Analyzes and classifies an email based on its content and context",
  parameters: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["APPRAISAL_LEAD", "STATUS_INQUIRY", "TECHNICAL_SUPPORT", "GENERAL_INQUIRY", "PAYMENT_ISSUE", "FEEDBACK"],
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
        description: "Detailed explanation of the classification"
      },
      suggestedResponseType: {
        type: "string",
        enum: ["detailed", "brief", "confirmation"],
        description: "The recommended type of response"
      }
    },
    required: ["intent", "urgency", "requiresReply", "reason", "suggestedResponseType"]
  }
};