import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
const WATCH_EXPIRATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

let auth = null;

async function getGmailAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: secrets.GMAIL_REFRESH_TOKEN });
    auth = oauth2Client;
  }
  return auth;
}

export async function renewGmailWatch() {
  try {
    const auth = await getGmailAuth();
    const response = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName: process.env.PUBSUB_TOPIC,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    
    logger.info('Gmail watch renewed successfully', { 
      historyId: response.data.historyId,
      expiration: response.data.expiration 
    });
    recordMetric('gmail_watch_renewals', 1);
    return response.data;
  } catch (error) {
    logger.error('Error renewing Gmail watch:', error);
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
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

async function sendReply(auth, { to, subject, body, threadId, references, inReplyTo }) {
  try {
    const message = [
      'From: me',
      `To: ${to}`,
      `Subject: Re: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      references ? `References: ${references}` : '',
      inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
      '',
      body
    ].filter(Boolean).join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      auth,
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId
      }
    });

    logger.info('Reply sent successfully', { to, subject });
    recordMetric('replies_sent', 1);
  } catch (error) {
    logger.error('Error sending reply:', error);
    recordMetric('reply_failures', 1);
    throw error;
  }
}

export async function processGmailNotification(data) {
  try {
    const auth = await getGmailAuth();
    const emailContent = await getEmailContent(auth, data.messageId);
    
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