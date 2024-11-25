import express from 'express';
import { logger } from './utils/logger.js';
import { setupGmailWatch } from './services/gmailWatch.js';
import { handleWebhook, sendEmail } from './services/gmailService.js';
import { getSecrets } from './utils/secretManager.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

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

app.post('/api/gmail/webhook', async (req, res) => {
  try {
    logger.info('Webhook received', { body: JSON.stringify(req.body) });
    await handleWebhook(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

app.post('/api/email/send', verifyApiKey, async (req, res) => {
  try {
    const { to, subject, body, threadId } = req.body;

    // Validate required fields
    if (!to || !subject || !body) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['to', 'subject', 'body']
      });
    }

    // Send email
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
  res.status(200).json({ status: 'healthy' });
});

async function startServer() {
  try {
    await setupGmailWatch();
    
    app.listen(PORT, () => {
      logger.info('Server started', { port: PORT });
    });
  } catch (error) {
    logger.error('Startup error:', error);
    process.exit(1);
  }
}

startServer();