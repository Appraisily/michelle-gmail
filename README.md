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

// Connection confirmation
{
  type: 'connect_confirm',
  clientId: 'user-provided-id',
  conversationId: 'unique-conversation-id',
  status: 'confirmed',
  timestamp: '2024-11-26T16:04:31.000Z'
}

// Server stores client data
{
  id: 'user-provided-id',
  socket: WebSocket,
  lastSeen: timestamp,
  conversationId: 'unique-conversation-id',
  isAlive: true,
  messageCount: 0,
  connectionStatus: 'confirmed'
}
```

#### Message Delivery Protocol
```javascript
// 1. Client sends message
{
  type: 'message',
  clientId: 'user-provided-id',
  messageId: 'unique-message-id',
  content: 'message content',
  timestamp: '2024-11-26T16:04:30.965Z'
}

// 2. Server confirms receipt
{
  type: 'confirm',
  messageId: 'unique-message-id',
  status: 'received',
  timestamp: '2024-11-26T16:04:31.000Z'
}

// 3. Server sends response
{
  type: 'response',
  messageId: 'response-message-id',
  replyTo: 'original-message-id',
  content: 'response content',
  timestamp: '2024-11-26T16:04:31.100Z'
}

// 4. Client confirms response receipt
{
  type: 'confirm',
  messageId: 'response-message-id',
  status: 'delivered',
  timestamp: '2024-11-26T16:04:31.200Z'
}
```

### 3. Direct Message Processing API

#### Endpoint
```http
POST /api/process-message
Content-Type: multipart/form-data
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
    conversationId?: string
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

#### Features
- Direct text and image processing
- Secure file upload handling
- Comprehensive input validation
- Rate limiting and access control
- Integration with existing OpenAI processing
- Detailed response metadata
- Error handling with specific codes

#### Image Processing Protocol
```javascript
// 1. Client sends message with image
{
  type: 'message',
  clientId: 'user-provided-id',
  messageId: 'unique-message-id',
  content: 'optional message text',
  images: [{
    id: 'image-unique-id',
    data: 'base64-encoded-image',
    mimeType: 'image/jpeg',
    filename: 'optional-original-name.jpg'
  }],
  timestamp: '2024-11-26T16:04:30.965Z'
}

// 2. Server confirms image receipt
{
  type: 'image_status',
  messageId: 'unique-message-id',
  imageId: 'image-unique-id',
  status: 'received',
  timestamp: '2024-11-26T16:04:31.000Z'
}

// 3. Server updates processing status
{
  type: 'image_status',
  messageId: 'unique-message-id',
  imageId: 'image-unique-id',
  status: 'processing',
  timestamp: '2024-11-26T16:04:31.100Z'
}

// 4. Server sends analysis response
{
  type: 'response',
  messageId: 'response-message-id',
  replyTo: 'original-message-id',
  content: 'response with analysis',
  imageAnalysis: [{
    imageId: 'image-unique-id',
    description: 'detailed description',
    category: 'item category',
    condition: 'item condition',
    features: ['notable feature 1', 'notable feature 2'],
    recommendations: ['professional recommendation 1', 'professional recommendation 2']
  }],
  timestamp: '2024-11-26T16:04:32.000Z'
}
```

### 4. OpenAI Integration
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
Response Router
```

### Direct Message Processing Flow
```
API Request
  ↓
Input Validator
  ├── Message Format Check
  ├── Image Validation
  └── Context Verification
  ↓
Image Processor
  ├── Format Validation
  ├── Size Check
  └── Base64 Conversion
  ↓
OpenAI Service
  ├── Context Building
  ├── Image Analysis
  └── Text Generation
  ↓
Response Generator
  ├── Format Response
  ├── Add Metadata
  └── Error Handling
  ↓
API Response
```

## Key Components

### Chat System Components
- Connection Manager: Handles WebSocket connections and client tracking
- Message Processor: Validates and processes incoming messages
- Context Manager: Maintains conversation history and state
- Response Handler: Formats and sends responses
- Heartbeat Service: Maintains connection health
- Rate Limiter: Prevents message flooding
- Image Queue: Manages image processing state
- Message Queue: Handles message delivery and retries

### Image Processing
- Support for JPEG, PNG, GIF, WebP formats
- Maximum image size: 10MB
- Parallel processing up to 10 images
- 30-second timeout per image
- Automatic retry on failure
- Progress status updates
- Detailed analysis results

### Message Delivery
- Unique message IDs
- Delivery confirmation protocol
- 5-second delivery timeout
- Maximum 3 retry attempts
- Exponential backoff
- Status tracking
- Error recovery

### Monitoring and Logging
- Detailed error tracking
- Performance metrics
- Client activity logging
- Processing statistics
- Health checks
- Image processing metrics
- Message delivery stats

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
- Image queue management
- Message delivery tracking
- Conversation cleanup after 30 minutes of inactivity

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