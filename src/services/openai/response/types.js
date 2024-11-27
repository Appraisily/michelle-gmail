export interface ResponseOptions {
  classification: {
    intent: string;
    urgency: 'high' | 'medium' | 'low';
    suggestedResponseType: 'detailed' | 'brief' | 'confirmation';
  };
  companyKnowledge: any;
  senderInfo?: {
    name?: string;
    email: string;
  };
  threadMessages?: Array<{
    date: string;
    content: string;
    isIncoming: boolean;
  }>;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
  }>;
}

export interface ImageAttachment {
  mimeType: string;
  buffer: Buffer;
}

export interface GeneratedResponse {
  generatedReply: string;
  imageAnalysis?: string | null;
}