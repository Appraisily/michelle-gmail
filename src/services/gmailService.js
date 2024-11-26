import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { classifyAndProcessEmail } from './openai/index.js';
import { logEmailProcessing } from './sheetsService.js';

const gmail = google.gmail('v1');
const processedMessages = new Set();
let lastHistoryId = null;

// Clean up old processed messages periodically
setInterval(() => {
  const oldestMessages = Array.from(processedMessages).slice(0, 500);
  oldestMessages.forEach(id => processedMessages.delete(id));
}, 1000 * 60 * 60); // Every hour

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic'
];

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

async function getHistory(auth, startHistoryId) {
  try {
    return await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      labelId: 'INBOX'
    });
  } catch (error) {
    logger.error('Error fetching history:', error);
    throw error;
  }
}

async function downloadAttachment(auth, messageId, attachmentId) {
  try {
    const attachment = await gmail.users.messages.attachments.get({
      auth,
      userId: 'me',
      messageId,
      id: attachmentId
    });

    return Buffer.from(attachment.data.data, 'base64');
  } catch (error) {
    logger.error('Error downloading attachment:', error);
    return null;
  }
}

async function extractImageAttachments(auth, message) {
  try {
    const parts = message.payload.parts || [];
    const imageAttachments = [];

    for (const part of parts) {
      if (part.mimeType && SUPPORTED_IMAGE_TYPES.includes(part.mimeType)) {
        const attachmentId = part.body.attachmentId;
        if (attachmentId) {
          const buffer = await downloadAttachment(auth, message.id, attachmentId);
          if (buffer) {
            imageAttachments.push({
              filename: part.filename,
              mimeType: part.mimeType,
              buffer
            });
          }
        }
      }
    }

    return imageAttachments;
  } catch (error) {
    logger.error('Error extracting image attachments:', error);
    return [];
  }
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

async function getThreadMessages(auth, threadId) {
  try {
    const thread = await gmail.users.threads.get({
      auth,
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const messages = thread.data.messages
      .map(message => {
        const headers = message.payload.headers;
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
        const content = parseEmailContent(message.payload);
        const timestamp = parseInt(message.internalDate);
        
        return {
          from,
          content,
          timestamp,
          date: new Date(timestamp).toISOString(),
          isIncoming: !from.includes(process.env.GMAIL_USER_EMAIL)
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    logger.info('Thread messages retrieved', {
      threadId,
      messageCount: messages.length
    });

    return messages;
  } catch (error) {
    logger.error('Error fetching thread:', error);
    return null;
  }
}

async function processMessage(auth, messageId) {
  // Skip if message was already processed
  if (processedMessages.has(messageId)) {
    logger.info('Skipping already processed message', { messageId });
    return true;
  }

  try {
    const message = await gmail.users.messages.get({
      auth,
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const headers = message.data.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value;
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
    const content = parseEmailContent(message.data.payload);
    const threadId = message.data.threadId;

    // Extract email address
    const emailMatch = from.match(/<([^>]+)>/) || [null, from.split(' ').pop()];
    const senderEmail = emailMatch[1];

    logger.info('Processing email', {
      messageId: message.data.id,
      threadId,
      subject,
      from
    });

    // Get thread messages for context
    const threadMessages = await getThreadMessages(auth, threadId);

    // Only process if this is the latest message
    const isLatestMessage = threadMessages && 
      threadMessages[threadMessages.length - 1].timestamp === parseInt(message.data.internalDate);

    if (!isLatestMessage) {
      logger.info('Skipping non-latest message in thread', {
        messageId,
        threadId
      });
      processedMessages.add(messageId);
      return true;
    }

    // Extract image attachments if any
    const imageAttachments = await extractImageAttachments(auth, message.data);

    // Process with OpenAI
    const result = await classifyAndProcessEmail(
      content,
      senderEmail,
      threadMessages,
      imageAttachments
    );

    // Log to sheets
    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      messageId: message.data.id,
      sender: from,
      subject,
      hasImages: imageAttachments.length > 0,
      requiresReply: result.requiresReply,
      reply: result.generatedReply || 'No reply needed',
      reason: result.reason,
      analysis: result.analysis
    });

    // Mark message as processed
    processedMessages.add(messageId);

    return true;
  } catch (error) {
    logger.error('Error processing message:', error);
    return false;
  }
}

export async function handleWebhook(data) {
  try {
    const auth = await getGmailAuth();
    const decodedData = JSON.parse(Buffer.from(data.message.data, 'base64').toString());
    
    if (!decodedData.historyId) {
      throw new Error('No historyId in notification');
    }

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      lastHistoryId = profile.data.historyId;
    }

    const history = await getHistory(auth, lastHistoryId);

    if (history.data.history) {
      for (const item of history.data.history) {
        logger.info('Processing history item', {
          historyId: item.id,
          messageCount: item.messages?.length
        });

        if (!item.messages) continue;

        const processPromises = item.messages.map(message => 
          processMessage(auth, message.id)
        );

        await Promise.all(processPromises);
      }
    }

    // Update lastHistoryId after successful processing
    lastHistoryId = decodedData.historyId;
    logger.info('Updated history ID', { historyId: lastHistoryId });

  } catch (error) {
    logger.error('Webhook processing failed:', error);
    throw error;
  }
}

export async function sendEmail(to, subject, body, threadId = null) {
  try {
    const auth = await getGmailAuth();
    
    // Create email content
    const email = [
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `To: ${to}`,
      'From: Michelle Thompson <info@appraisily.com>',
      `Subject: ${subject}`,
      '',
      body
    ].join('\n');

    const encodedEmail = Buffer.from(email).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const params = {
      auth,
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
        ...(threadId && { threadId })
      }
    };

    const result = await gmail.users.messages.send(params);

    logger.info('Email sent successfully', {
      to,
      subject,
      messageId: result.data.id,
      threadId: result.data.threadId
    });

    return {
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId
    };
  } catch (error) {
    logger.error('Failed to send email:', error);
    throw error;
  }
}