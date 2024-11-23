import express from 'express';
import cron from 'node-cron';
import { logger } from './utils/logger.js';
import { setupMetrics } from './utils/monitoring.js';
import { getSecrets } from './utils/secretManager.js';
import { setupGmailWatch, isWatchExpiringSoon } from './services/gmailWatch.js';
import { verifyGmailAccess } from './services/gmailAuth.js';
import { handleWebhook } from './services/gmailService.js';

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
    logger.info('Starting service initialization...', { 
      env: process.env.NODE_ENV,
      email: 'info@appraisily.com'
    });
    
    const requiredEnvVars = ['PROJECT_ID', 'PUBSUB_TOPIC', 'PUBSUB_SUBSCRIPTION'];
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

    // Verify Gmail access
    await verifyGmailAccess();
    logger.info('Gmail access verified successfully');

    // Initialize Gmail watch
    await setupGmailWatch();
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

    // Check if watch needs renewal
    if (isWatchExpiringSoon()) {
      logger.info('Watch expiring soon, initiating renewal');
      await setupGmailWatch();
    }

    await handleWebhook(req.body);
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
    await setupGmailWatch();
    logger.info('Gmail watch renewed successfully');
  } catch (error) {
    logger.error('Failed to renew Gmail watch:', error);
  }
});

// Initialize services before starting server
async function startServer() {
  try {
    await initializeServices();

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