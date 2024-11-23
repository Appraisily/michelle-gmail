import express from 'express';
import { google } from 'googleapis';
import { getSecrets } from './utils/secretManager.js';
import { logger } from './utils/logger.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
let gmail;
let lastHistoryId;

async function initializeGmail() {
  try {
    const secrets = await getSecrets();
    
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Get initial profile and history ID
    const profile = await gmail.users.getProfile({
      userId: 'me'
    });
    
    lastHistoryId = profile.data.historyId;
    
    logger.info('Gmail initialized', {
      email: profile.data.emailAddress,
      historyId: lastHistoryId
    });

    // Set up Gmail watch
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    
    await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE'
      }
    });

    logger.info('Gmail watch set up successfully', { topicName });
  } catch (error) {
    logger.error('Failed to initialize Gmail:', error);
    throw error;
  }
}

app.post('/api/gmail/webhook', async (req, res) => {
  try {
    const message = req.body.message;
    if (!message?.data) {
      return res.status(400).send('Invalid request');
    }

    const decodedData = Buffer.from(message.data, 'base64').toString();
    const data = JSON.parse(decodedData);

    logger.info('Webhook received', {
      historyId: data.historyId,
      email: data.emailAddress
    });

    if (!lastHistoryId) {
      lastHistoryId = data.historyId;
      return res.status(200).send('OK');
    }

    const history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded']
    });

    if (history.data.history) {
      for (const record of history.data.history) {
        for (const msg of record.messagesAdded || []) {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: msg.message.id
          });

          logger.info('New email received', {
            id: message.data.id,
            threadId: message.data.threadId,
            snippet: message.data.snippet
          });
        }
      }
    }

    lastHistoryId = data.historyId;
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Start server
async function startServer() {
  try {
    await initializeGmail();
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();