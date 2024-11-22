import express from 'express';
import cron from 'node-cron';
import { processGmailNotification, renewGmailWatch } from './services/gmailService.js';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';
import { getSecrets } from './utils/secretManager.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize services
async function initializeServices() {
  try {
    logger.info('Starting service initialization...');
    
    // Load secrets first
    await getSecrets();
    logger.info('Secrets loaded successfully');
    
    // Setup monitoring
    await setupMetrics().catch(error => {
      logger.error('Failed to setup metrics:', error);
    });
    logger.info('Metrics setup completed');

    // Initial Gmail watch setup
    try {
      await renewGmailWatch();
      logger.info('Initial Gmail watch setup completed');
    } catch (error) {
      logger.error('Failed initial Gmail watch setup:', error);
      // Don't throw here, as we can retry later with cron
    }

    logger.info('Services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

// Schedule Gmail watch renewal (every 6 days)
cron.schedule('0 0 */6 * *', async () => {
  logger.info('Running scheduled Gmail watch renewal...');
  try {
    await renewGmailWatch();
    logger.info('Scheduled Gmail watch renewal completed successfully');
  } catch (error) {
    logger.error('Failed to renew Gmail watch:', error);
  }
});

// Webhook endpoint for Gmail notifications via Pub/Sub
app.post('/notifications', async (req, res) => {
  try {
    const message = req.body.message;
    if (!message) {
      return res.status(400).send('No Pub/Sub message received');
    }

    // Verify the subscription
    const subscription = message.attributes?.subscription;
    if (subscription !== process.env.PUBSUB_SUBSCRIPTION) {
      logger.warn(`Unexpected subscription: ${subscription}`);
      return res.status(400).send('Invalid subscription');
    }

    const data = Buffer.from(message.data, 'base64').toString();
    await processGmailNotification(JSON.parse(data));
    
    res.status(200).send('Notification processed successfully');
  } catch (error) {
    logger.error('Error processing notification:', error);
    res.status(500).send('Error processing notification');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Initialize services and start server
initializeServices().then(() => {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}).catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});