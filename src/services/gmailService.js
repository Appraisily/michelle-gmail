import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
let auth = null;

async function getGmailAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    // Verify the credentials work
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.getProfile({ userId: 'me' });
      logger.info('Gmail credentials verified successfully');
    } catch (error) {
      logger.error('Gmail credentials verification failed:', error);
      throw new Error('Gmail authentication failed');
    }

    auth = oauth2Client;
    logger.info('Gmail authentication initialized successfully');
  }
  return auth;
}

async function stopExistingWatch() {
  try {
    const auth = await getGmailAuth();
    await gmail.users.stop({
      userId: 'me',
      auth
    });
    logger.info('Stopped existing Gmail watch');
  } catch (error) {
    // If no watch exists, that's fine
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
    } else {
      logger.warn('Error stopping existing Gmail watch:', error);
    }
  }
}

async function getEmailContent(auth, messageId) {
  try {
    const response = await gmail.users.messages.get({
      auth,
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const { payload, threadId } = response.data;
    const headers = payload.headers;
    
    const subject = headers.find(h => h.name === 'Subject')?.value;
    const from = headers.find(h => h.name === 'From')?.value;
    const references = headers.find(h => h.name === 'References')?.value;
    const inReplyTo = headers.find(h => h.name === 'In-Reply-To')?.value;
    const body = decodeEmailBody(payload);

    return { subject, from, body, threadId, references, inReplyTo };
  } catch (error) {
    logger.error('Error fetching email content:', error);
    recordMetric('email_fetch_failures', 1);
    throw error;
  }
}

async function processHistory(historyId) {
  try {
    const auth = await getGmailAuth();
    
    const response = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: historyId,
      historyTypes: ['messageAdded']
    });

    if (!response.data.history) {
      logger.info('No new messages in history');
      return { processed: true, messages: 0 };
    }

    let processedCount = 0;
    for (const history of response.data.history) {
      for (const message of history.messagesAdded || []) {
        try {
          const emailContent = await getEmailContent(auth, message.message.id);
          await processGmailNotification(emailContent);
          processedCount++;
        } catch (error) {
          logger.error('Error processing message:', error);
          recordMetric('processing_failures', 1);
        }
      }
    }

    return { processed: true, messages: processedCount };
  } catch (error) {
    logger.error('Error processing history:', error);
    throw error;
  }
}

function decodeEmailBody(payload) {
  if (payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString();
  }

  if (payload.parts) {
    return payload.parts
      .filter(part => part.mimeType === 'text/plain')
      .map(part => Buffer.from(part.body.data, 'base64').toString())
      .join('\n');
  }

  return '';
}

export async function renewGmailWatch() {
  try {
    logger.info('Starting Gmail watch renewal process...');
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    logger.info(`Using Pub/Sub topic: ${topicName}`);
    
    const auth = await getGmailAuth();
    
    // First, check current Gmail profile
    try {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      logger.info(`Current Gmail profile historyId: ${profile.data.historyId}`);
    } catch (error) {
      logger.error('Error fetching Gmail profile:', error);
      throw error;
    }

    // Stop any existing watch
    await stopExistingWatch();

    // Set up new watch
    const response = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    
    const expirationDate = new Date(parseInt(response.data.expiration));
    logger.info('Gmail watch renewed successfully', { 
      historyId: response.data.historyId,
      expiration: expirationDate.toISOString(),
      topicName
    });

    // Verify the watch was set up
    try {
      const labels = await gmail.users.labels.list({
        auth,
        userId: 'me'
      });
      logger.info('Gmail labels verified:', labels.data.labels.map(l => l.name));
    } catch (error) {
      logger.error('Error verifying Gmail labels:', error);
    }

    recordMetric('gmail_watch_renewals', 1);
    return response.data;
  } catch (error) {
    logger.error('Error renewing Gmail watch:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

export async function processGmailNotification(emailContent) {
  try {
    const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
    
    if (requiresReply) {
      await sendReply(auth, {
        to: emailContent.from,
        subject: emailContent.subject,
        body: generatedReply,
        threadId: emailContent.threadId,
        references: emailContent.references,
        inReplyTo: emailContent.inReplyTo
      });
    }

    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      sender: emailContent.from,
      subject: emailContent.subject,
      content: emailContent.body,
      requiresReply,
      reply: generatedReply || 'No reply needed'
    });

    recordMetric('emails_processed', 1);
  } catch (error) {
    logger.error('Error processing Gmail notification:', error);
    recordMetric('processing_failures', 1);
    throw error;
  }
}

export async function handleWebhook(data) {
  const startTime = Date.now();
  logger.info('Processing Gmail webhook:', data);
  
  try {
    const result = await processHistory(data.historyId);
    const processingTime = Date.now() - startTime;
    
    logger.info('Webhook processing completed', {
      ...result,
      processingTime
    });
    
    return result;
  } catch (error) {
    logger.error('Webhook processing failed:', error);
    throw error;
  }
}