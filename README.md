# Gmail Watch-based Email Processing Service

This service automatically processes incoming emails using Gmail API watch notifications, OpenAI for classification and response generation, and logs activities to Google Sheets.

## Environment Variables

The following environment variables are required for the service to function properly:

### Core Environment Variables
```
PROJECT_ID=your-gcp-project-id        # Your Google Cloud Project ID
PUBSUB_TOPIC=gmail-notifications      # The Pub/Sub topic name for Gmail notifications
PUBSUB_SUBSCRIPTION=gmail-notifications-sub  # The Pub/Sub subscription name
```

### Required Secrets
The following secrets must be configured in Google Cloud Secret Manager with these exact names:

```
GMAIL_CLIENT_ID          # Gmail OAuth Client ID
GMAIL_CLIENT_SECRET      # Gmail OAuth Client Secret
GMAIL_REFRESH_TOKEN      # Gmail OAuth Refresh Token
OPENAI_API_KEY          # OpenAI API Key for email classification
MICHELLE_CHAT_LOG_SPREADSHEETID  # Google Sheets ID for logging
```

## Setup Instructions

1. Create a Pub/Sub topic named `gmail-notifications`
2. Create a Pub/Sub subscription named `gmail-notifications-sub` for the topic
3. Configure the required secrets in Google Cloud Secret Manager:
   ```bash
   # Create secrets in Secret Manager (run for each secret)
   gcloud secrets create GMAIL_CLIENT_ID --replication-policy="automatic"
   gcloud secrets create GMAIL_CLIENT_SECRET --replication-policy="automatic"
   gcloud secrets create GMAIL_REFRESH_TOKEN --replication-policy="automatic"
   gcloud secrets create OPENAI_API_KEY --replication-policy="automatic"
   gcloud secrets create MICHELLE_CHAT_LOG_SPREADSHEETID --replication-policy="automatic"

   # Add secret versions (replace 'your-secret-value' with actual values)
   gcloud secrets versions add GMAIL_CLIENT_ID --data-file="path/to/client-id.txt"
   gcloud secrets versions add GMAIL_CLIENT_SECRET --data-file="path/to/client-secret.txt"
   gcloud secrets versions add GMAIL_REFRESH_TOKEN --data-file="path/to/refresh-token.txt"
   gcloud secrets versions add OPENAI_API_KEY --data-file="path/to/openai-key.txt"
   gcloud secrets versions add MICHELLE_CHAT_LOG_SPREADSHEETID --data-file="path/to/sheet-id.txt"
   ```
4. Deploy using Cloud Build and Cloud Run

## Deployment

The service is automatically deployed using Cloud Build. The `cloudbuild.yaml` file handles:
- Building the Docker container
- Setting up environment variables
- Configuring secrets
- Deploying to Cloud Run

## Architecture

- **Gmail Watch**: Monitors inbox for new emails
- **Pub/Sub**: Handles Gmail notifications
- **OpenAI**: Classifies emails and generates responses
- **Google Sheets**: Logs all email processing activities
- **Cloud Run**: Hosts the service
- **Secret Manager**: Securely stores credentials

## Monitoring

The service includes built-in monitoring using Cloud Monitoring:
- Email processing metrics
- Classification results
- Reply generation statistics
- Error tracking

## Logging

Logs are available in:
- Cloud Run logs
- Custom application logs (error.log, combined.log)
- Google Sheets activity log