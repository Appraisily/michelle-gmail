/**
 * Functions related to sales data analysis
 */

export const salesAnalysisFunction = {
  name: "analyzeSalesContext",
  description: "Analyzes sales-related context from customer data",
  parameters: {
    type: "object",
    properties: {
      checkSales: {
        type: "boolean",
        description: "Whether to check sales information"
      },
      filters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Specific sale session ID to check"
          },
          stripeCustomerId: {
            type: "string",
            description: "Stripe customer ID to check"
          }
        }
      }
    },
    required: ["checkSales"]
  }
};