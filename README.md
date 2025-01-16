# Michelle - AI Assistant Service

Michelle is an advanced AI assistant service that processes emails, chat messages, and direct requests using Gmail API watch notifications, real-time WebSocket communication, and OpenAI for intelligent processing. The service provides seamless communication across multiple channels while maintaining context and conversation history.

## Core Features

### 1. Email Processing
- Real-time email monitoring via Gmail Watch API
- Automatic thread context analysis
- Image attachment processing with GPT-4V
- Smart response generation
- Rate-limited processing with retries
- Pagination support for history fetching
- Duplicate message detection
- Thread context preservation

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

### 3. Direct Message Processing

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

Request:
```javascript
{
  "to": "recipient@email.com",
  "subject": "Email Subject",
  "body": "Email content in HTML format",
  "threadId": "optional-thread-id"
}
```

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
- DIRECT_API_KEY
- SHARED_SECRET

## Architecture

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

## Performance Features

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

## Development

### Installation
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

### Docker Support
```bash
# Build container
docker build -t michelle-ai .

# Run container
docker run -p 8080:8080 michelle-ai
```

## Deployment

The service is designed to run on Google Cloud Run with the following features:
- Automatic scaling
- Memory: 512Mi
- CPU: 1
- Minimum instances: 1
- Maximum instances: 10
- Request timeout: 300s
- Port: 8080

### Cloud Build Configuration
The service includes a `cloudbuild.yaml` for automated deployment with:
- Container build and push
- Cloud Run deployment
- Cloud Scheduler job creation for Gmail watch renewal
- Health check job setup

## Logging and Monitoring

### Google Sheets Integration
- Email processing logs
- Chat conversation tracking
- Session statistics
- Performance metrics

### Structured Logging
- Request/response logging
- Error tracking
- Performance monitoring
- Health status
- Security events

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

This project is proprietary software. All rights reserved.