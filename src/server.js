import express from 'express';
import { logger } from './utils/logger.js';
import { setupGmailWatch } from './services/gmailWatch.js';
import { handleWebhook } from './services/gmailService.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Webhook endpoint
app.post('/api/gmail/webhook', async (req, res) => {
  try {
    logger.info('Received webhook request');
    await handleWebhook(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Error processing webhook:', error);
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
    // Initialize Gmail watch first
    await setupGmailWatch();
    logger.info('Gmail watch initialized successfully');

    // Start the server
    app.listen(PORT, () => {
      logger.info('Server started successfully', { port: PORT });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();