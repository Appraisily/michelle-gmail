import express from 'express';
import http from 'http';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger.js';
import { setupGmailWatch, renewWatch } from './services/gmail/watch.js';
import { handleWebhook } from './services/gmail/webhook.js';
import { sendEmail } from './services/gmail/message.js';
import { getSecrets } from './utils/secretManager.js';
import { initializeChatService } from './services/chat/index.js';
import { processDirectMessage } from './services/direct/index.js';

const app = express();
app.use(express.json());
app.use(multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files
  }
}).array('images', 5));

// Enable trust proxy since we're behind Cloud Run
app.set('trust proxy', true);

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket for chat
initializeChatService(server);

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Middleware to verify API key for DataHub endpoints
async function verifyApiKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const secrets = await getSecrets();
    if (apiKey !== secrets.DATA_HUB_API_KEY) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
  } catch (error) {
    logger.error('API key verification failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Middleware to verify direct message API key
async function verifyDirectApiKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    const secrets = await getSecrets();
    // Use DIRECT_API_KEY for the direct message endpoint
    if (apiKey !== secrets.DIRECT_API_KEY) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
  } catch (error) {
    logger.error('Direct API key verification failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Middleware to verify shared secret for watch renewal
async function verifySharedSecret(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const secrets = await getSecrets();
    const token = authHeader.split(' ')[1];
    
    if (token !== secrets.SHARED_SECRET) {
      return res.status(403).json({ error: 'Invalid authorization' });
    }

    next();
  } catch (error) {
    logger.error('Authorization verification failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

app.post('/api/gmail/webhook', async (req, res) => {
  try {
    logger.info('Webhook received', { body: JSON.stringify(req.body) });

    // Extract Pub/Sub message data
    const message = req.body.message;
    const subscription = req.body.subscription;

    if (!message || !subscription) {
      logger.error('Invalid Pub/Sub message format');
      return res.status(400).json({ error: 'Invalid message format' });
    }

    // Process the webhook
    await handleWebhook(req.body);

    // Acknowledge the message by sending 200 status
    res.status(200).json({ 
      status: 'success',
      messageId: message.messageId,
      subscription 
    });

    logger.info('Pub/Sub message acknowledged', { 
      messageId: message.messageId,
      subscription 
    });
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

app.post('/api/gmail/renew-watch', verifySharedSecret, async (req, res) => {
  try {
    logger.info('Manual watch renewal requested');
    await renewWatch();
    res.status(200).json({ message: 'Watch renewed successfully' });
  } catch (error) {
    logger.error('Manual watch renewal failed:', error);
    res.status(500).json({ error: 'Watch renewal failed' });
  }
});

app.post('/api/email/send', verifyApiKey, async (req, res) => {
  try {
    const { to, subject, body, threadId } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['to', 'subject', 'body']
      });
    }

    const result = await sendEmail(to, subject, body, threadId);
    
    res.status(200).json(result);
  } catch (error) {
    logger.error('Email sending failed:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

// Direct message processing endpoint
app.post('/api/process-message',
  verifyDirectApiKey, // Use specific middleware for direct message endpoint
  limiter,
  async (req, res) => {
    try {
      const result = await processDirectMessage(req);
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logger.error('Direct message processing failed:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          details: [error.message]
        }
      });
    }
  }
);

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

async function startServer() {
  try {
    // Force Gmail watch setup on startup
    logger.info('Starting server with forced Gmail watch setup');
    await setupGmailWatch();
    
    server.listen(PORT, () => {
      logger.info('Server started', { port: PORT });
    });
  } catch (error) {
    logger.error('Startup error:', error);
    process.exit(1);
  }
}

startServer();