export const dataHubFunction = {
  name: "makeDataHubRequest",
  description: "Makes a request to Data Hub API",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "API endpoint path (e.g., /appraisals/pending)"
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
    required: ["path", "method"]
  }
};