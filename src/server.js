import express from 'express';
import cron from 'node-cron';
import { processGmailNotification, renewGmailWatch } from './services/gmailService.js';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Setup monitoring metrics
await setupMetrics().catch(error => {
  logger.error('Failed to setup metrics:', error);
});

// Schedule Gmail watch renewal (every 6 days)
cron.schedule('0 0 */6 * *', async () => {
  try {
    await renewGmailWatch();
    logger.info('Gmail watch renewed successfully');
  } catch (error) {
    logger.error('Failed to renew Gmail watch:', error);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
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

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});