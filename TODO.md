# Interaction History Implementation Plan

## Overview
Implement a unified interaction history system to track all customer interactions across email, chat, and direct message channels.

## Data Structure
```typescript
interface Interaction {
  id: string;
  clientId: string;
  timestamp: Date;
  channel: 'email' | 'chat' | 'direct';
  type: 'inquiry' | 'appraisal_request' | 'status_check';
  content: {
    input: {
      text?: string;
      images?: Array<{
        id: string;
        analysis: string;
      }>;
    };
    aiResponse: string;
    classification: {
      intent: string;
      urgency: string;
    };
  };
  metadata: {
    email?: string;
    conversationId?: string;
    threadId?: string;
  };
}
```

## Implementation Steps

### 1. DataHub API Extensions
- Add new endpoints for interaction history:
  - POST /api/interactions - Store new interaction
  - GET /api/interactions/client/{clientId} - Get client history
  - GET /api/interactions/search - Search interactions

### 2. Create InteractionHistoryService
- Location: src/services/interactionHistory/
- Files:
  - index.js - Main service exports
  - client.js - DataHub API client for interactions
  - types.js - TypeScript interfaces
  - utils.js - Helper functions

### 3. Integration Points
- Email Service:
  ```javascript
  // After OpenAI processing
  await interactionHistory.recordInteraction({
    channel: 'email',
    clientId,
    content: {
      input: { text: emailContent, images },
      aiResponse: response,
      classification
    },
    metadata: { 
      email: senderEmail,
      threadId 
    }
  });
  ```

- Chat Service:
  ```javascript
  // After message processing
  await interactionHistory.recordInteraction({
    channel: 'chat',
    clientId,
    content: {
      input: { text: message.content, images },
      aiResponse: response,
      classification
    },
    metadata: { 
      conversationId 
    }
  });
  ```

- Direct Message Service:
  ```javascript
  // After processing request
  await interactionHistory.recordInteraction({
    channel: 'direct',
    clientId,
    content: {
      input: { text: req.body.text, images },
      aiResponse: response,
      classification
    }
  });
  ```

### 4. Context Enhancement
- Update OpenAI prompts to include relevant interaction history
- Add history context to classification process
- Enhance response generation with historical context

### 5. Monitoring & Logging
- Add metrics for interaction recording
- Implement error handling for failed recordings
- Add debug logging for interaction processing

## Future Enhancements
- Implement interaction analytics
- Add interaction categorization
- Create customer insights based on interaction history
- Implement interaction search functionality