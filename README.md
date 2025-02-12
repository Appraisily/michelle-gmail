# Gmail Watch-based Email Processing Service

A comprehensive backend service that processes emails, chat messages, and direct requests using Gmail API watch notifications, real-time WebSocket communication, and OpenAI for intelligent processing. The service integrates with Data Hub API for appraisal and sales data management.

## Core Services

### 1. Email Processing Service
- Real-time email monitoring via Gmail Watch API
- Automatic thread context analysis
- Image attachment processing with GPT-4V
- Smart response generation
- Rate-limited processing with retries
- Pagination support for history fetching
- Duplicate message detection
- Thread context preservation
- Automatic watch renewal

### 2. Real-time Chat System
- WebSocket-based communication
- Message rate limiting (1 second cooldown)
- Automatic reconnection handling
- Client state tracking
- Welcome messages for new connections
- Heartbeat mechanism (60-second interval)
- Conversation context preservation
- Error handling with retries
- Secure client identification
- Image processing queue management
- Message delivery confirmation
- Connection state management

### 3. Direct Message Processing API

#### Endpoint
```http
POST /api/process-message
Content-Type: multipart/form-data
X-API-Key: DIRECT_API_KEY
```

#### Request Format
```javascript
{
  text: string,          // Message text content
  images?: File[],       // Optional array of image files
  senderEmail?: string,  // Optional sender email for context
  senderName?: string,   // Optional sender name
  context?: {           // Optional additional context
    threadId?: string,
    conversationId?: string,
    wordpressUrl?: string
  }
}
```

#### Success Response
```javascript
{
  "success": true,
  "response": {
    "text": "Generated response text",
    "imageAnalysis": "Image analysis details (if images provided)",
    "metadata": {
      "processingTime": "123ms",
      "imagesProcessed": 2,
      "model": "gpt-4o"
    }
  }
}
```

#### Error Response
```javascript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid image format",
    "details": ["Only JPG, PNG formats are supported"]
  }
}
```

### 4. CRM Integration Service
- Real-time interaction tracking
- Multi-channel support (email, chat, direct)
- Pub/Sub based message processing with configurable topics
- Automatic data transformation
- Error handling and retries
- Interaction history tracking
- Customer context preservation
- AI-powered conversation analysis
- Sentiment tracking
- Topic extraction
- Automated chat summaries

### 5. OpenAI Integration
- GPT-4o for email/chat classification
- GPT-4V for image analysis
- Context-aware response generation
- Automatic retry logic
- Token limit management
- Error handling and fallbacks
- Model selection based on input type
- Response formatting
- Conversation history tracking

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
CRM Publisher
  ↓
CRM Publisher
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
  ├── Message Queue
  └── Heartbeat Monitoring
  ↓
Message Processor
  ├── Format Validator
  ├── Context Manager
  ├── Image Queue
  └── Retry Handler
  ↓
OpenAI Integration
  ├── Message Classification
  ├── Image Analysis
  └── Response Generation
  ↓
CRM Publisher
  ├── Chat Summary Generation
  ├── Topic Extraction
  └── Sentiment Analysis
  ↓
CRM Publisher
  ↓
Response Router
```

### CRM Integration Flow
```
Interaction Event
  ↓
Data Transformer
  ├── Email Transformer
  ├── Chat Transformer
  └── Direct Message Transformer
  ↓
CRM Publisher
  ↓
Pub/Sub Topic
  ↓
CRM Subscriber
  ↓
Data Processing
  ├── Customer Record Update
  ├── Interaction History
  └── Analytics
```

## API Endpoints

### WebSocket /chat
Real-time chat connection endpoint.

Message Types:
- `connect`: Initial connection message
- `connect_confirm`: Connection confirmation
- `message`: Chat message
- `response`: Server response
- `error`: Error message
- `ping/pong`: Connection health check
- `confirm`: Message delivery confirmation
- `image_status`: Image processing status

### POST /api/gmail/webhook
Receives Gmail notifications via Pub/Sub push subscription.

### POST /api/gmail/renew-watch
Manually renews Gmail watch subscription.

### POST /api/email/send
Sends emails through Gmail API.

### POST /api/process-message
Direct message processing endpoint.

### GET /health
Health check endpoint.

## Configuration

### Environment Variables
```
PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
PUBSUB_TOPIC=gmail-notifications
PUBSUB_CRM_NAME=your-crm-topic-name
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
- DIRECT_API_KEY
- SHARED_SECRET

## Performance Optimizations

### Chat System
- Message batching
- Rate limiting (1 second cooldown)
- Connection pooling
- Heartbeat optimization
- State cleanup
- Context truncation
- Image queue management
- Message delivery tracking
- Conversation cleanup after 30 minutes of inactivity
- AI-powered conversation analysis
- Automated topic extraction
- Sentiment analysis
- Chat summary generation

### Email Processing
- Message batching (5 messages per batch)
- Thread depth limiting (10 messages)
- Content truncation for large emails
- Duplicate message detection
- Parallel message processing

### Direct Message Processing
- Input validation caching
- Image processing queue
- Parallel image analysis
- Response caching
- Rate limiting per client
- Request deduplication
- Performance monitoring

### Memory Management
- LRU cache for processed messages
- History ID tracking cleanup
- Client state pruning
- Context truncation
- Image optimization
- Message queue cleanup

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
- Sentiment tracking
- Topic analysis
- Conversation summaries
- Health checks
- Image processing metrics
- Message delivery stats

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
- Image size validation
- Message validation