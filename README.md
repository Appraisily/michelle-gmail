# Gmail Watch-based Email Processing Service

This service automatically processes incoming emails using Gmail API watch notifications, OpenAI for classification and response generation, and logs activities to Google Sheets.

## Required Permissions

### 1. Service Account Permissions
Run these commands to grant necessary permissions to your service account:

```bash
# Set environment variables
export PROJECT_ID=civil-forge-403609
export SERVICE_ACCOUNT=856401495068-compute@developer.gserviceaccount.com

# Grant Pub/Sub Publisher permissions to Gmail service
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
    --role="roles/pubsub.publisher"

# Grant Pub/Sub Subscriber permissions to your service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/pubsub.subscriber"

# Grant Secret Manager access to your service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
```

### 2. Gmail API Scope Requirements
Ensure your OAuth consent screen includes these scopes:
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.settings.basic`
- `https://www.googleapis.com/auth/gmail.readonly`

## Environment Variables

The following environment variables are required:

### Core Environment Variables
```
PROJECT_ID=your-gcp-project-id                    # Your Google Cloud Project ID
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id       # Alternative Project ID variable
PUBSUB_TOPIC=gmail-notifications-michelle         # The Pub/Sub topic name for Gmail notifications
PUBSUB_SUBSCRIPTION=gmail-notifications-sub-michelle  # The Pub/Sub subscription name
GMAIL_USER_EMAIL=info@appraisily.com             # The Gmail address being monitored
```

### Required Secrets
Configure these secrets in Google Cloud Secret Manager:

```
GMAIL_CLIENT_ID          # Gmail OAuth Client ID
GMAIL_CLIENT_SECRET      # Gmail OAuth Client Secret
GMAIL_REFRESH_TOKEN      # Gmail OAuth Refresh Token
OPENAI_API_KEY          # OpenAI API Key for email classification
MICHELLE_CHAT_LOG_SPREADSHEETID  # Google Sheets ID for logging
```

## Setup Instructions

1. Create a Pub/Sub topic and subscription:
   ```bash
   # Create the topic
   gcloud pubsub topics create gmail-notifications-michelle

   # Create the subscription
   gcloud pubsub subscriptions create gmail-notifications-sub-michelle \
       --topic gmail-notifications-michelle \
       --push-endpoint=https://michelle-gmail-856401495068.us-central1.run.app/api/gmail/webhook \
       --ack-deadline=60 \
       --message-retention-duration=1d
   ```

2. Configure secrets in Secret Manager:
   ```bash
   # Create secrets
   gcloud secrets create GMAIL_CLIENT_ID --replication-policy="automatic"
   gcloud secrets create GMAIL_CLIENT_SECRET --replication-policy="automatic"
   gcloud secrets create GMAIL_REFRESH_TOKEN --replication-policy="automatic"
   gcloud secrets create OPENAI_API_KEY --replication-policy="automatic"
   gcloud secrets create MICHELLE_CHAT_LOG_SPREADSHEETID --replication-policy="automatic"

   # Add secret versions (replace with actual values)
   echo -n "your-client-id" | gcloud secrets versions add GMAIL_CLIENT_ID --data-file=-
   echo -n "your-client-secret" | gcloud secrets versions add GMAIL_CLIENT_SECRET --data-file=-
   echo -n "your-refresh-token" | gcloud secrets versions add GMAIL_REFRESH_TOKEN --data-file=-
   echo -n "your-openai-key" | gcloud secrets versions add OPENAI_API_KEY --data-file=-
   echo -n "your-sheet-id" | gcloud secrets versions add MICHELLE_CHAT_LOG_SPREADSHEETID --data-file=-
   ```

3. Deploy using Cloud Build:
   ```bash
   gcloud builds submit
   ```

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

## Troubleshooting

If the Gmail watch is not working:

1. Verify Pub/Sub permissions:
   ```bash
   # Check if Gmail service can publish to Pub/Sub
   gcloud pubsub topics get-iam-policy gmail-notifications-michelle
   ```

2. Verify service account permissions:
   ```bash
   # Check service account roles
   gcloud projects get-iam-policy $PROJECT_ID \
       --flatten="bindings[].members" \
       --format='table(bindings.role)' \
       --filter="bindings.members:$SERVICE_ACCOUNT"
   ```

3. Check Cloud Run logs for specific error messages:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=michelle-gmail" --limit=50
   ```