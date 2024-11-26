# Gmail Watch-based Email Processing Service

This service automatically processes incoming emails using Gmail API watch notifications, OpenAI for classification and response generation, and logs activities to Google Sheets. It integrates with Data Hub API for appraisal and sales data.

## Core Features

### 1. Email Processing
- Real-time email monitoring via Gmail Watch API
- Automatic thread context analysis
- Image attachment processing with GPT-4V
- Smart response generation
- Rate-limited processing with retries
- Pagination support for history fetching

### 2. Real-time Chat System
#### Connection Management
```javascript
// Initial connection message
{
  type: 'connect',
  clientId: 'user-provided-id',
  timestamp: '2024-11-26T16:04:30.965Z'
}

// Server stores client data
{
  id: 'user-provided-id',
  socket: WebSocket,
  lastSeen: timestamp,
  conversationId: 'unique-conversation-id',
  isAlive: true,
  messageCount: 0
}
```

#### Message Format
```javascript
// Incoming message structure
{
  type: 'message',
  clientId: 'user-provided-id',
  conversationId: 'stored-conversation-id',
  messageId: 'unique-message-id',
  content: 'message content',
  timestamp: '2024-11-26T16:04:30.965Z'
}

// Response structure
{
  type: 'response',
  clientId: 'original-client-id',
  conversationId: 'original-conversation-id',
  messageId: 'response-message-id',
  replyTo: 'original-message-id',
  content: 'response content',
  timestamp: '2024-11-26T16:04:31.000Z'
}
```

#### Features
- WebSocket-based real-time chat
- Message rate limiting (1 second cooldown)
- Automatic reconnection handling
- Client state tracking
- Welcome messages for new connections
- Heartbeat mechanism (60-second interval)
- Conversation context preservation
- Error handling with retries
- Secure client identification

### 3. OpenAI Integration
- GPT-4o for email/chat classification
- GPT-4V for image analysis
- Context-aware response generation
- Automatic retry logic
- Token limit management
- Error handling and fallbacks

## Architecture Overview

### Email Processing Flow
```
Gmail Inbox
  ↓
Gmail Watch API (with forced renewal)
  ↓
Pub/Sub Topic (historyId)
  ↓
Webhook Handler
  ↓
History Fetcher (with pagination)
  ↓
Message Processor
  ├── Thread Context Gatherer
  ├── Image Attachment Extractor
  └── Content Parser
  ↓
OpenAI Processor
  ├── Message Classification
  ├── Image Analysis (if applicable)
  └── Response Generation
  ↓
Google Sheets Logger
```

### Chat System Architecture
```
WebSocket Connection
  ↓
Connection Manager
  ├── Client State Tracking
  ├── Rate Limiting
  └── Heartbeat Monitoring
  ↓
Message Processor
  ├── Format Validator
  ├── Context Manager
  └── Retry Handler
  ↓
OpenAI Integration
  ├── Message Classification
  └── Response Generation
  ↓
Response Router
```

## Key Components

### Chat System Components
- Connection Manager: Handles WebSocket connections and client tracking
- Message Processor: Validates and processes incoming messages
- Context Manager: Maintains conversation history and state
- Response Handler: Formats and sends responses
- Heartbeat Service: Maintains connection health
- Rate Limiter: Prevents message flooding

### Gmail Watch Management
- Forced watch renewal during startup
- Automatic cleanup of existing watches
- History ID tracking and validation
- Pagination support for large history sets
- Error recovery mechanisms

### Message Processing
- Batch processing support
- Thread context preservation
- MIME content parsing
- Image attachment handling
- Rate limiting and throttling
- Duplicate message detection

### Monitoring and Logging
- Detailed error tracking
- Performance metrics
- Client activity logging
- Processing statistics
- Health checks

## API Endpoints

### WebSocket /chat
Real-time chat connection endpoint.

Message Types:
- `connect`: Initial connection message
- `message`: Chat message
- `response`: Server response
- `error`: Error message
- `ping/pong`: Connection health check

### POST /api/gmail/webhook
Receives Gmail notifications via Pub/Sub push subscription.

### POST /api/gmail/renew-watch
Manually renews Gmail watch subscription.

### POST /api/email/send
Sends emails through Gmail API.

### GET /health
Health check endpoint.

## Configuration

### Environment Variables
```
PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
PUBSUB_TOPIC=gmail-notifications
PUBSUB_SUBSCRIPTION=gmail-notifications-sub
GMAIL_USER_EMAIL=info@appraisily.com
NODE_ENV=production
```

### Required Secrets
- GMAIL_CLIENT_ID
- GMAIL_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN
- OPENAI_API_KEY
- MICHELLE_CHAT_LOG_SPREADSHEETID
- DATA_HUB_API_KEY
- SHARED_SECRET

## Performance Optimizations

### Chat System
- Message batching
- Rate limiting (1 second cooldown)
- Connection pooling
- Heartbeat optimization
- State cleanup
- Context truncation
- Conversation cleanup after 30 minutes of inactivity

### Email Processing
- Message batching (5 messages per batch)
- Thread depth limiting (10 messages)
- Content truncation for large emails
- Duplicate message detection
- Parallel message processing

### Memory Management
- LRU cache for processed messages
- History ID tracking cleanup
- Client state pruning
- Context truncation
- Image optimization

## Error Handling

### Retry Logic
- Maximum 3 retries for failed operations
- 1-second delay between retries
- Exponential backoff for API calls
- Graceful degradation
- Error recovery strategies

### Monitoring
- Error tracking
- Performance metrics
- Client connection status
- Processing statistics
- Health checks

## Security Features

### Authentication
- OAuth 2.0 for Gmail API
- API key validation
- Shared secret for watch renewal
- Rate limiting
- Input validation

### Data Protection
- Secure WebSocket connections
- Environment variable encryption
- Secret management
- Access control
- Data sanitization