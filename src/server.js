import express from 'express';
import cron from 'node-cron';
import { handleWebhook, renewGmailWatch } from './services/gmailService.js';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';
import { getSecrets } from './utils/secretManager.js';

const app = express();
// Increase JSON payload limit for larger messages
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// Track processed message IDs to prevent duplicates
const processedMessages = new Set();
const MESSAGE_RETENTION_TIME = 60 * 60 * 1000; // 1 hour

// Cleanup old processed messages periodically
setInterval(() => {
  const now = Date.now();
  processedMessages.clear();
  logger.info('Cleared processed messages cache');
}, MESSAGE_RETENTION_TIME);

// Initialize services
async function initializeServices() {
  try {
    logger.info('Starting service initialization...');
    
    // Validate required environment variables
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
    
    // Load secrets first
    await getSecrets();
    logger.info('Secrets loaded successfully');
    
    // Setup monitoring
    await setupMetrics();
    logger.info('Metrics setup completed');

    // Initial Gmail watch setup
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
      headers: req.headers,
      bodySize: JSON.stringify(req.body).length,
      hasMessage: !!req.body?.message,
      messageId: req.body?.message?.messageId
    });

    const message = req.body.message;
    if (!message) {
      logger.warn('No message received in webhook', { 
        body: JSON.stringify(req.body),
        contentType: req.headers['content-type']
      });
      return res.status(400).send('No message received');
    }

    // Log full message structure for debugging
    logger.info('Pub/Sub message structure', {
      messageId: message.messageId,
      publishTime: message.publishTime,
      attributes: message.attributes,
      hasData: !!message.data,
      dataSize: message.data ? message.data.length : 0
    });

    // Check for duplicate messages
    if (processedMessages.has(message.messageId)) {
      logger.info('Duplicate message received, skipping', { messageId: message.messageId });
      return res.status(200).send('Message already processed');
    }

    if (!message.data) {
      logger.warn('No data field in message', { 
        message: JSON.stringify(message),
        messageKeys: Object.keys(message)
      });
      return res.status(400).send('No data field in message');
    }

    // Decode and parse the message data
    const decodedData = Buffer.from(message.data, 'base64').toString();
    logger.info('Decoded message data', { 
      decodedData,
      decodedLength: decodedData.length,
      isJSON: isValidJSON(decodedData)
    });

    let parsedData;
    try {
      parsedData = JSON.parse(decodedData);
      logger.info('Parsed message data', { 
        parsedData,
        hasHistoryId: !!parsedData?.historyId,
        historyId: parsedData?.historyId
      });
    } catch (parseError) {
      logger.error('Failed to parse message data', { 
        error: parseError.message,
        decodedData 
      });
      return res.status(400).send('Invalid message data format');
    }

    // Process the webhook data
    await handleWebhook(parsedData);
    
    // Mark message as processed
    processedMessages.add(message.messageId);
    
    res.status(200).send('Notification processed successfully');
  } catch (error) {
    logger.error('Error processing webhook:', {
      error: error.message,
      stack: error.stack,
      body: JSON.stringify(req.body)
    });
    // Return 500 to trigger Pub/Sub retry
    res.status(500).send('Error processing notification');
  }
});

// Helper function to check if a string is valid JSON
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

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