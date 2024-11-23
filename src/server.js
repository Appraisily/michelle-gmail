import express from 'express';
import cron from 'node-cron';
import { handleWebhook, renewGmailWatch } from './services/gmailService.js';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';
import { getSecrets } from './utils/secretManager.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

async function initializeServices() {
  try {
    logger.info('Starting service initialization...');
    
    const requiredEnvVars = ['PROJECT_ID', 'PUBSUB_TOPIC', 'PUBSUB_SUBSCRIPTION', 'GMAIL_USER_EMAIL'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    logger.info('Environment variables validated', {
      projectId: process.env.PROJECT_ID,
      pubsubTopic: process.env.PUBSUB_TOPIC,
      pubsubSubscription: process.env.PUBSUB_SUBSCRIPTION,
      gmailUser: process.env.GMAIL_USER_EMAIL
    });
    
    await getSecrets();
    logger.info('Secrets loaded successfully');
    
    await setupMetrics();
    logger.info('Metrics setup completed');

    try {
      await renewGmailWatch();
      logger.info('Initial Gmail watch setup completed');
    } catch (error) {
      logger.error('Failed initial Gmail watch setup:', error);
    }

    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

// Schedule Gmail watch renewal (every 6 days)
cron.schedule('0 0 */6 * *', async () => {
  try {
    logger.info('Running scheduled Gmail watch renewal...');
    await renewGmailWatch();
    logger.info('Scheduled Gmail watch renewal completed successfully');
  } catch (error) {
    logger.error('Failed to renew Gmail watch:', error);
  }
});

// Webhook endpoint for Gmail notifications via Pub/Sub
app.post('/api/gmail/webhook', async (req, res) => {
  try {
    logger.info('Received webhook request', {
      bodySize: JSON.stringify(req.body).length,
      hasMessage: !!req.body?.message
    });

    const message = req.body.message;
    if (!message) {
      logger.warn('No message in webhook body', { body: req.body });
      return res.status(400).send('No message received');
    }

    if (!message.data) {
      logger.warn('No data in Pub/Sub message', { message });
      return res.status(400).send('No data in message');
    }

    // Decode base64 data
    const decodedData = Buffer.from(message.data, 'base64').toString();
    logger.info('Decoded Pub/Sub data', { decodedData });

    let parsedData;
    try {
      parsedData = JSON.parse(decodedData);
      logger.info('Parsed notification data', { 
        emailHistoryId: parsedData.historyId,
        hasHistoryId: !!parsedData.historyId
      });
    } catch (error) {
      logger.error('Failed to parse message data', { error, decodedData });
      return res.status(400).send('Invalid message format');
    }

    if (!parsedData.historyId) {
      logger.warn('No historyId in notification', { parsedData });
      return res.status(400).send('No historyId in notification');
    }

    // Process the notification
    await handleWebhook(parsedData);
    res.status(200).send('Notification processed successfully');
  } catch (error) {
    logger.error('Error processing webhook:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).send('Error processing notification');
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

initializeServices().then(() => {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}).catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});