# Gmail Watch-based Email Processing Service

This service automatically processes incoming emails using Gmail API watch notifications, OpenAI for classification and response generation, and logs activities to Google Sheets. It integrates with Data Hub API for appraisal and sales data.

## Architecture Overview

### Current Implementation (Email Processing)
```
Gmail Inbox
  ↓
Gmail Watch API
  ↓
Pub/Sub Topic (historyId)
  ↓
Webhook
  ↓
Gmail API (fetch history)
  ↓
Gmail API (fetch full message)
  ↓
Data Hub API (fetch endpoints)
  ↓
OpenAI (classification)
  ↓
Data Hub API (customer data)
  ↓
OpenAI (response generation)
  ↓
Google Sheets (logging)
```

### Future Multimodal Architecture
The system is designed to be extended for multiple communication channels:

```
Communication Channels
├── Email (Gmail) - Currently Implemented
├── WordPress Comments - Future
└── Live Chat - Future

Message Processing Flow
├── Channel Adapters
│   ├── Gmail Adapter (active)
│   ├── WordPress Adapter (planned)
│   └── LiveChat Adapter (planned)
│
├── Message Queue (Pub/Sub)
│   └── Channel-specific topics
│
├── Unified Message Format
│   ├── Channel identifier
│   ├── Sender information
│   ├── Content
│   └── Metadata
│
└── Response Router
    └── Channel-specific formatters
```

### Image Processing Pipeline (Planned)
```
Email with Attachments
  ↓
Image Detection & Extraction
  ↓
GPT-4V Analysis
  ├── Object Description
  ├── Condition Assessment
  ├── Age Estimation
  └── Notable Features
  ↓
Preliminary Value Range
  ↓
Response Generation
  ├── Quick Assessment
  ├── Value Indication
  └── Professional Appraisal Offer
```

## Service Requirements

1. **Gmail Watch Management**
   - Initial watch setup during service startup
   - Watch expires after 7 days
   - Automatic renewal via Cloud Scheduler every 6 hours
   - Only one active watch allowed per Gmail account
   - Health check every 15 minutes to prevent cold starts

2. **Authentication Requirements**
   - Gmail OAuth2 credentials
   - Service account with appropriate permissions
   - OpenAI API key for email processing
   - Google Sheets access for logging
   - Data Hub API key for appraisal/sales data
   - Shared secret for watch renewal endpoint

3. **Runtime Requirements**
   - Node.js v20 or higher
   - Memory: 512Mi minimum
   - CPU: 1 core minimum
   - Persistent internet connection

## API Endpoints

### POST /api/gmail/webhook
Receives Gmail notifications via Pub/Sub push subscription.

**Request Body**: Pub/Sub message format
```json
{
  "message": {
    "data": "base64-encoded-data",
    "attributes": {},
    "messageId": "message-id",
    "publishTime": "publish-time"
  },
  "subscription": "subscription-name"
}
```

### POST /api/gmail/renew-watch
Manually renews Gmail watch subscription. Requires authentication.

**Headers**:
```
Authorization: Bearer <shared-secret>
```

### POST /api/email/send
Sends emails through Gmail API.

**Authentication Required**: Yes (API Key)

**Headers**:
```
X-API-Key: your_api_key_here
```

**Request Body**:
```json
{
  "to": "recipient@example.com",
  "subject": "Email Subject",
  "body": "Email content in HTML format",
  "threadId": "optional-gmail-thread-id"
}
```

**Response**:
```json
{
  "success": true,
  "messageId": "message-id",
  "threadId": "thread-id"
}
```

### GET /health
Health check endpoint for service monitoring.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-11-26T07:51:36.826Z"
}
```

## Data Hub Integration

The service integrates with Data Hub API for customer data:

1. **Endpoint Discovery**
   - Fetches available endpoints on startup
   - Caches endpoint information (5-minute TTL)
   - Provides endpoint documentation to OpenAI

2. **Data Retrieval**
   - Appraisal status (pending/completed)
   - Sales information
   - Customer history

3. **Authentication**
   - Uses API key from Secret Manager
   - Includes rate limiting protection
   - Handles request retries

## OpenAI Integration

### 1. Email Analysis
- Analyzes email content and thread context
- Determines intent and urgency
- Identifies required data lookups
- Suggests response type

### 2. Response Generation
- Considers full conversation thread
- Incorporates customer data
- Maintains consistent tone
- Includes standardized signature

### 3. Function Definitions
- Appraisal-related functions
- Sales-related functions
- Email analysis functions
- Response generation functions

### 4. Image Analysis (Planned)
- Process image attachments
- Use GPT-4V for visual analysis
- Generate detailed object descriptions
- Provide preliminary value assessments

## Google Sheets Logging

The service logs all email processing activities:

### Sheet Structure

1. **Timestamp**: Processing date/time (UTC)
2. **Sender**: Email sender
3. **Subject**: Email subject
4. **Requires Reply**: Yes/No
5. **Reason**: Analysis explanation
6. **Intent**: Classified intent
7. **Urgency**: Priority level
8. **Response Type**: Response format
9. **Tone**: Response tone
10. **Reply**: Generated response

### Log Entry Example
```
Timestamp: 2024-11-26T07:51:36.826Z
Sender: customer@example.com
Subject: Appraisal Status Inquiry
Requires Reply: Yes
Reason: Customer requesting status update
Intent: followup
Urgency: medium
Response Type: detailed
Tone: friendly
Reply: [Full response text]
```

## Required Permissions

### Service Account Permissions
```bash
# Set environment variables
export PROJECT_ID=your-project-id
export SERVICE_ACCOUNT=your-service-account@your-project.iam.gserviceaccount.com

# Grant Pub/Sub permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
    --role="roles/pubsub.publisher"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/pubsub.subscriber"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
```

### Gmail API Scopes
Required OAuth scopes:
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.settings.basic`
- `https://www.googleapis.com/auth/gmail.readonly`

## Environment Variables

```
PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
PUBSUB_TOPIC=gmail-notifications
PUBSUB_SUBSCRIPTION=gmail-notifications-sub
GMAIL_USER_EMAIL=info@appraisily.com
NODE_ENV=production
```

## Required Secrets

Configure in Secret Manager:
```bash
# Create secrets
gcloud secrets create GMAIL_CLIENT_ID --replication-policy="automatic"
gcloud secrets create GMAIL_CLIENT_SECRET --replication-policy="automatic"
gcloud secrets create GMAIL_REFRESH_TOKEN --replication-policy="automatic"
gcloud secrets create OPENAI_API_KEY --replication-policy="automatic"
gcloud secrets create MICHELLE_CHAT_LOG_SPREADSHEETID --replication-policy="automatic"
gcloud secrets create DATA_HUB_API_KEY --replication-policy="automatic"
gcloud secrets create SHARED_SECRET --replication-policy="automatic"

# Add values
echo -n "your-client-id" | gcloud secrets versions add GMAIL_CLIENT_ID --data-file=-
echo -n "your-client-secret" | gcloud secrets versions add GMAIL_CLIENT_SECRET --data-file=-
echo -n "your-refresh-token" | gcloud secrets versions add GMAIL_REFRESH_TOKEN --data-file=-
echo -n "your-openai-key" | gcloud secrets versions add OPENAI_API_KEY --data-file=-
echo -n "your-sheet-id" | gcloud secrets versions add MICHELLE_CHAT_LOG_SPREADSHEETID --data-file=-
echo -n "your-data-hub-key" | gcloud secrets versions add DATA_HUB_API_KEY --data-file=-
echo -n "your-shared-secret" | gcloud secrets versions add SHARED_SECRET --data-file=-
```

## Setup Instructions

1. Create Pub/Sub infrastructure:
   ```bash
   # Create topic
   gcloud pubsub topics create gmail-notifications

   # Create subscription
   gcloud pubsub subscriptions create gmail-notifications-sub \
       --topic gmail-notifications \
       --push-endpoint=https://your-service-url/api/gmail/webhook \
       --ack-deadline=60 \
       --message-retention-duration=1d
   ```

2. Deploy using Cloud Build:
   ```bash
   gcloud builds submit
   ```

## Monitoring

Built-in monitoring metrics:
- Email classifications
- Reply generations
- OpenAI failures
- Data Hub requests
- API latencies

## Logging

Cloud Run log levels:
- ERROR: Critical failures
- WARNING: Important issues
- INFO: Normal operations
- DEBUG: Development details

## Troubleshooting

Common issues and solutions:

1. **Gmail Watch Issues**
   ```bash
   # Check Pub/Sub permissions
   gcloud pubsub topics get-iam-policy gmail-notifications
   ```

2. **Service Account Problems**
   ```bash
   # Verify permissions
   gcloud projects get-iam-policy $PROJECT_ID \
       --flatten="bindings[].members" \
       --format='table(bindings.role)' \
       --filter="bindings.members:$SERVICE_ACCOUNT"
   ```

3. **Data Hub API Errors**
   - Check API key in Secret Manager
   - Verify rate limits
   - Check endpoint availability

4. **OpenAI Issues**
   - Verify API key
   - Check quota usage
   - Review function definitions