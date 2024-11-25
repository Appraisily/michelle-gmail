# Gmail Watch-based Email Processing Service

This service automatically processes incoming emails using Gmail API watch notifications, OpenAI for classification and response generation, and logs activities to Google Sheets.

## Project Structure

```
├── src/
│   ├── server.js              # Main application entry point
│   ├── services/
│   │   ├── dataHub/          # Data Hub API integration
│   │   │   ├── client.js     # API client implementation
│   │   │   ├── types.js      # TypeScript-like type definitions
│   │   │   └── index.js      # Main export file
│   │   ├── openai/           # OpenAI integration
│   │   │   ├── functions.js  # Function definitions
│   │   │   ├── prompts.js    # System prompts
│   │   │   └── index.js      # Main processing logic
│   │   ├── gmailService.js   # Gmail API integration
│   │   └── sheetsService.js  # Google Sheets logging
│   └── utils/
│       ├── logger.js         # Centralized logging
│       ├── monitoring.js     # Cloud Monitoring metrics
│       └── secretManager.js  # Secret Manager integration
├── Dockerfile                # Container configuration
├── cloudbuild.yaml          # Cloud Build deployment
├── package.json             # Project dependencies
└── README.md                # Project documentation
```

## Service Requirements

1. **Gmail Watch Management**
   - Initial watch setup during service startup
   - Watch expires after 7 days
   - Automatic renewal via cron job every 6 days
   - Only one active watch allowed per Gmail account

2. **Authentication Requirements**
   - Gmail OAuth2 credentials
   - Service account with appropriate permissions
   - OpenAI API key for email processing
   - Google Sheets access for logging
   - Data Hub API key for appraisal data

3. **Runtime Requirements**
   - Node.js v20 or higher
   - Memory: 512Mi minimum
   - CPU: 1 core minimum
   - Persistent internet connection

## Email Processing Flow

1. **Gmail Watch Setup**
   - Service establishes a watch on the Gmail inbox
   - Gmail monitors for new emails or label changes
   - When changes occur, Gmail sends notifications to a Pub/Sub topic

2. **Notification Process**
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
   OpenAI (classification)
     ↓
   Data Hub API (appraisal status)
     ↓
   OpenAI (response generation)
     ↓
   Google Sheets (logging)
   ```

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

## Google Sheets Logging

The service automatically logs all email processing activities to a Google Sheets document for monitoring and review.

### Sheet Structure

The service maintains a "Logs" sheet with the following columns:

1. **Timestamp**: Date and time of processing (EST)
2. **Sender**: Email sender's address
3. **Subject**: Email subject line
4. **Requires Reply**: Whether the email needed a response (Yes/No)
5. **Reason**: Analysis explanation
6. **Intent**: Classified email intent (question/request/information/followup/other)
7. **Urgency**: Classified urgency level (high/medium/low)
8. **Response Type**: Suggested response type (detailed/brief/confirmation/none)
9. **Tone**: Response tone used (formal/friendly/neutral)
10. **Reply**: Generated response or "No reply needed"

### Log Entry Example

```
Timestamp: 11/25/2024, 6:36:11 AM
Sender: customer@example.com
Subject: Appraisal Status Inquiry
Requires Reply: Yes
Reason: Customer requesting status update on pending appraisal
Intent: followup
Urgency: medium
Response Type: detailed
Tone: friendly
Reply: [Full response text]
```

### Sheet Initialization

The service automatically:
1. Creates the "Logs" sheet if it doesn't exist
2. Adds headers if it's a new sheet
3. Appends new logs to the next available row

### Access Requirements

The service account needs the following permissions:
- Google Sheets API access
- Write permissions to the specified spreadsheet

### Configuration

1. Create a Google Sheet and share it with the service account email
2. Add the Sheet ID to Secret Manager:
   ```bash
   echo -n "your-sheet-id" | gcloud secrets versions add MICHELLE_CHAT_LOG_SPREADSHEETID --data-file=-
   ```

### Viewing Logs

1. Access the Google Sheet using the provided ID
2. The most recent entries appear at the bottom
3. Use Google Sheets' filtering and sorting features to analyze logs

## Required Permissions

### Service Account Permissions
Run these commands to grant necessary permissions:

```bash
# Set environment variables
export PROJECT_ID=your-project-id
export SERVICE_ACCOUNT=your-service-account@your-project.iam.gserviceaccount.com

# Grant Pub/Sub Publisher permissions to Gmail service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
    --role="roles/pubsub.publisher"

# Grant Pub/Sub Subscriber permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/pubsub.subscriber"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
```

### Gmail API Scopes
Required OAuth consent screen scopes:
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.settings.basic`
- `https://www.googleapis.com/auth/gmail.readonly`

## Environment Variables

Required environment variables:

```
PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
PUBSUB_TOPIC=gmail-notifications
PUBSUB_SUBSCRIPTION=gmail-notifications-sub
GMAIL_USER_EMAIL=info@appraisily.com
NODE_ENV=production
```

## Required Secrets

Configure these in Google Cloud Secret Manager:

```
GMAIL_CLIENT_ID          # Gmail OAuth Client ID
GMAIL_CLIENT_SECRET      # Gmail OAuth Client Secret
GMAIL_REFRESH_TOKEN      # Gmail OAuth Refresh Token
OPENAI_API_KEY          # OpenAI API Key
MICHELLE_CHAT_LOG_SPREADSHEETID  # Google Sheets ID
DATA_HUB_API_KEY        # Data Hub API Key
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

2. Configure secrets:
   ```bash
   # Create secrets
   gcloud secrets create GMAIL_CLIENT_ID --replication-policy="automatic"
   gcloud secrets create GMAIL_CLIENT_SECRET --replication-policy="automatic"
   gcloud secrets create GMAIL_REFRESH_TOKEN --replication-policy="automatic"
   gcloud secrets create OPENAI_API_KEY --replication-policy="automatic"
   gcloud secrets create MICHELLE_CHAT_LOG_SPREADSHEETID --replication-policy="automatic"
   gcloud secrets create DATA_HUB_API_KEY --replication-policy="automatic"

   # Add secret versions
   echo -n "your-client-id" | gcloud secrets versions add GMAIL_CLIENT_ID --data-file=-
   echo -n "your-client-secret" | gcloud secrets versions add GMAIL_CLIENT_SECRET --data-file=-
   echo -n "your-refresh-token" | gcloud secrets versions add GMAIL_REFRESH_TOKEN --data-file=-
   echo -n "your-openai-key" | gcloud secrets versions add OPENAI_API_KEY --data-file=-
   echo -n "your-sheet-id" | gcloud secrets versions add MICHELLE_CHAT_LOG_SPREADSHEETID --data-file=-
   echo -n "your-data-hub-key" | gcloud secrets versions add DATA_HUB_API_KEY --data-file=-
   ```

3. Deploy using Cloud Build:
   ```bash
   gcloud builds submit
   ```

## Monitoring

The service includes built-in monitoring:
- Email processing metrics
- Classification results
- Reply generation statistics
- Error tracking

## Logging

Logs are available in Cloud Run logs with these severity levels:
- ERROR: Critical failures requiring immediate attention
- WARNING: Important issues that don't stop service operation
- INFO: Normal operational events
- DEBUG: Detailed information for troubleshooting (development only)

## Troubleshooting

If Gmail watch is not working:

1. Check Pub/Sub permissions:
   ```bash
   gcloud pubsub topics get-iam-policy gmail-notifications
   ```

2. Verify service account permissions:
   ```bash
   gcloud projects get-iam-policy $PROJECT_ID \
       --flatten="bindings[].members" \
       --format='table(bindings.role)' \
       --filter="bindings.members:$SERVICE_ACCOUNT"
   ```

3. Check Cloud Run logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision" --limit=50
   ```

Common issues:
- Empty notifications: Check Gmail Watch setup
- Missing historyId: Verify Gmail API authentication
- Processing failures: Check OpenAI API key and quotas
- Reply failures: Verify Gmail send permissions
- Data Hub API errors: Verify API key and permissions.