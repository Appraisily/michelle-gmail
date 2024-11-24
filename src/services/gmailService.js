import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;

async function getGmailAuth() {
  const secrets = await getSecrets();
  
  const auth = new google.auth.OAuth2(
    secrets.GMAIL_CLIENT_ID,
    secrets.GMAIL_CLIENT_SECRET
  );

  auth.setCredentials({
    refresh_token: secrets.GMAIL_REFRESH_TOKEN
  });

  return auth;
}

function parseEmailContent(payload) {
  let content = '';
  
  if (payload.mimeType === 'text/plain' && payload.body.data) {
    content = Buffer.from(payload.body.data, 'base64').toString();
  } else if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body.data) {
        content = Buffer.from(part.body.data, 'base64').toString();
        break;
      }
    }
  }
  
  return content;
}

function getEmailDetails(message) {
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
  const content = parseEmailContent(message.payload);
  
  return { subject, from, content };
}

export async function handleWebhook(data) {
  try {
    logger.info('Processing webhook data', { data: JSON.stringify(data) });

    if (!data.message || !data.message.data) {
      throw new Error('Invalid webhook data');
    }

    const decodedData = Buffer.from(data.message.data, 'base64').toString();
    logger.info('Decoded data', { decodedData });

    const notification = JSON.parse(decodedData);
    logger.info('Parsed notification', { notification });

    if (!notification.historyId) {
      throw new Error('No historyId in notification');
    }

    const auth = await getGmailAuth();

    // Initialize lastHistoryId if needed
    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      lastHistoryId = profile.data.historyId;
      logger.info('Initialized historyId', { historyId: lastHistoryId });
      return;
    }

    // Get message history
    const history = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: lastHistoryId
    });

    logger.info('History retrieved', {
      hasHistory: !!history.data.history,
      count: history.data.history?.length || 0
    });

    if (!history.data.history) {
      return;
    }

    // Process new messages
    for (const item of history.data.history) {
      if (!item.messages) continue;

      for (const message of item.messages) {
        const fullMessage = await gmail.users.messages.get({
          auth,
          userId: 'me',
          id: message.id,
          format: 'full'
        });

        const { subject, from, content } = getEmailDetails(fullMessage.data);
        
        logger.info('Processing email', {
          id: fullMessage.data.id,
          subject,
          from
        });

        // Process with OpenAI
        const { requiresReply, generatedReply, reason } = await classifyAndProcessEmail(content);

        // Log to Google Sheets
        await logEmailProcessing({
          timestamp: new Date().toISOString(),
          sender: from,
          subject,
          requiresReply,
          reply: generatedReply || 'No reply needed',
          reason
        });

        logger.info('Email processed', {
          id: fullMessage.data.id,
          requiresReply,
          hasReply: !!generatedReply,
          reason
        });
      }
    }

    lastHistoryId = notification.historyId;
    logger.info('Updated historyId', { historyId: lastHistoryId });
  } catch (error) {
    logger.error('Webhook processing failed:', error);
    throw error;
  }
}