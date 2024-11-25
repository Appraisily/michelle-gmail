export const dataHubFunctions = {
  getEndpoints: {
    name: "getDataHubEndpoints",
    description: "Fetches available Data Hub API endpoints and their specifications",
    parameters: {
      type: "object",
      properties: {}  // No parameters needed
    }
  },

  makeRequest: {
    name: "makeDataHubRequest",
    description: "Makes a request to Data Hub API using available endpoints",
    parameters: {
      type: "object",
      properties: {
        endpoint: {
          type: "string",
          description: "Full endpoint path (e.g., /api/appraisals/pending)"
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          description: "HTTP method"
        },
        params: {
          type: "object",
          description: "Query parameters",
          additionalProperties: true
        },
        body: {
          type: "object",
          description: "Request body for POST/PUT requests",
          additionalProperties: true
        }
      },
      required: ["endpoint", "method"]
    }
  }
};