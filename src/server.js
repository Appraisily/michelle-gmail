import express from 'express';
import { logger } from './utils/logger.js';
import { setupGmailWatch } from './services/gmailWatch.js';
import { handleWebhook } from './services/gmailService.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

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