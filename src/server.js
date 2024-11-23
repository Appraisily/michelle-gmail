import express from 'express';
import cron from 'node-cron';
import { handleWebhook, initializeGmailWatch } from './services/gmailService.js';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';
import { getSecrets } from './utils/secretManager.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
let isInitialized = false;
let initializationError = null;

// Health check endpoint
app.get('/health', (req, res) => {
  if (initializationError) {
    return res.status(500).json({
      status: 'error',
      error: initializationError.message
    });
  }

  res.status(200).json({
    status: isInitialized ? 'healthy' : 'initializing',
    uptime: process.uptime()
  });
});

// Initialize all services before starting the server
async function initializeServices() {
  try {
    logger.info('Starting service initialization...', { env: process.env.NODE_ENV });
    
    const requiredEnvVars = ['PROJECT_ID', 'PUBSUB_TOPIC', 'PUBSUB_SUBSCRIPTION', 'GMAIL_USER_EMAIL'];
    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    // Load secrets first
    await getSecrets();
    logger.info('Secrets loaded successfully');
    
    // Setup monitoring
    await setupMetrics();
    logger.info('Metrics setup completed');

    // Initialize Gmail watch
    await initializeGmailWatch();
    logger.info('Gmail watch initialized successfully');

    isInitialized = true;
    initializationError = null;
    logger.info('All services initialized successfully');
  } catch (error) {
    initializationError = error;
    logger.error('Failed to initialize services:', error);
    throw error;
  }
}

// Webhook endpoint
app.post('/api/gmail/webhook', async (req, res) => {
  if (!isInitialized) {
    logger.warn('Received webhook before initialization completed');
    return res.status(503).json({
      error: 'Service still initializing',
      status: 'error'
    });
  }

  try {
    logger.info('Received webhook request', {
      hasMessage: !!req.body?.message,
      messageData: req.body?.message?.data ? 'present' : 'missing'
    });

    const message = req.body.message;
    if (!message?.data) {
      logger.warn('Invalid webhook payload', { body: req.body });
      return res.status(400).json({
        error: 'Invalid webhook payload',
        status: 'error'
      });
    }

    const decodedData = Buffer.from(message.data, 'base64').toString();
    let parsedData;
    
    try {
      parsedData = JSON.parse(decodedData);
      logger.info('📨 Gmail Webhook Data', {
        historyId: parsedData.historyId,
        emailAddress: parsedData.emailAddress,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to parse webhook data', { error: error.message });
      return res.status(400).json({
        error: 'Invalid message format',
        status: 'error'
      });
    }

    if (!parsedData.historyId) {
      logger.warn('No historyId in webhook data');
      return res.status(400).json({
        error: 'No historyId provided',
        status: 'error'
      });
    }

    await handleWebhook(parsedData);
    res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Internal server error',
      status: 'error'
    });
  }
});

// Schedule Gmail watch renewal every 6 days
cron.schedule('0 0 */6 * *', async () => {
  try {
    logger.info('Running scheduled Gmail watch renewal');
    await initializeGmailWatch();
    logger.info('Gmail watch renewed successfully');
  } catch (error) {
    logger.error('Failed to renew Gmail watch:', error);
  }
});

// Initialize services before starting server
async function startServer() {
  try {
    // Initialize all services first
    await initializeServices();

    // Start server only after successful initialization
    const server = app.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        env: process.env.NODE_ENV,
        initialized: isInitialized
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down...');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down...');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', { reason, promise });
});

// Start the server
startServer();