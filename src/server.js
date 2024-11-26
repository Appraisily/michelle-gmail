import express from 'express';
import http from 'http';
import { logger } from './utils/logger.js';
import { setupGmailWatch, renewWatch } from './services/gmailWatch.js';
import { handleWebhook, sendEmail } from './services/gmailService.js';
import { getSecrets } from './utils/secretManager.js';
import { initializeChatService } from './services/chat/index.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket for chat
initializeChatService(server);

// Middleware to verify API key
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
    // Cloud Run automatically acknowledges Pub/Sub messages when returning 2xx status
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
    // Return non-2xx status to nack the message and trigger a retry
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

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

async function startServer() {
  try {
    // Initial Gmail watch setup
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