import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { classifyAndProcessEmail } from '../openai/index.js';
import { logEmailProcessing } from '../sheetsService.js';
import { extractImageAttachments } from './attachments.js';
import { createDraft } from './drafts.js';

const gmail = google.gmail('v1');
const processedMessages = new Set();
const MAX_THREAD_DEPTH = 10;
const MESSAGE_BATCH_SIZE = 5;

async function getThreadMessages(auth, threadId) {
  try {
    const thread = await gmail.users.threads.get({
      auth,
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    // Sort messages by date and limit thread depth
    const messages = thread.data.messages
      .map(message => {
        const headers = message.payload.headers;
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value;
        const content = parseEmailContent(message.payload);
        const timestamp = parseInt(message.internalDate);
        
        return {
          id: message.id,
          from,
          subject,
          content,
          timestamp,
          date: new Date(timestamp).toISOString(),
          isIncoming: !from.includes(process.env.GMAIL_USER_EMAIL),
          labels: message.labelIds || []
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp) // Sort newest first
      .slice(0, MAX_THREAD_DEPTH); // Keep only most recent messages

    logger.debug('Thread messages retrieved', {
      threadId,
      messageCount: messages.length,
      newestMessage: messages[0]?.date,
      oldestMessage: messages[messages.length - 1]?.date
    });

    return messages;
  } catch (error) {
    logger.error('Error fetching thread:', {
      error: error.message,
      threadId,
      stack: error.stack
    });
    return null;
  }
}

function parseEmailContent(payload, depth = 0) {
  const MAX_DEPTH = 5;
  let content = '';

  try {
    if (depth > MAX_DEPTH) {
      return content;
    }

    if (payload.mimeType === 'text/plain' && payload.body.data) {
      content = Buffer.from(payload.body.data, 'base64').toString();
    } else if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body.data) {
          content += Buffer.from(part.body.data, 'base64').toString();
        } else if (part.parts) {
          content += parseEmailContent(part, depth + 1);
        }
      }
    }

    // Clean up content
    content = content
      .replace(/\r\n/g, '\n')
      .replace(/^\s+|\s+$/g, '')
      .replace(/[\n\s]+$/g, '\n');

    return content;
  } catch (error) {
    logger.error('Error parsing email content:', {
      error: error.message,
      mimeType: payload.mimeType,
      hasBody: !!payload.body,
      hasParts: !!payload.parts,
      depth
    });
    return content;
  }
}

export async function processMessage(auth, messageId) {
  try {
    const message = await gmail.users.messages.get({
      auth,
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const threadId = message.data.threadId;

    // Check if message/thread should be processed
    const { shouldProcess, reason } = shouldProcessMessage(message.data, process.env.GMAIL_USER_EMAIL);
    if (!shouldProcess) {
      processedMessages.add(messageId);
      return true;
    }

    // Check if message was already processed
    if (processedMessages.has(messageId)) {
      logger.debug('Skipping already processed message', { messageId, threadId });
      return true;
    }

    const headers = message.data.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value;
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
    const content = parseEmailContent(message.data.payload);
    const labels = message.data.labelIds || [];

    // Extract email address
    const emailMatch = from.match(/<([^>]+)>/) || [null, from.split(' ').pop()];
    const senderEmail = emailMatch[1];
    const senderName = from.replace(/<.*>/, '').trim();

    const senderInfo = {
      name: senderName,
      email: senderEmail
    };

    logger.debug('Processing email message', {
      messageId: message.data.id,
      threadId,
      subject,
      from: senderInfo,
      labels,
      timestamp: new Date(parseInt(message.data.internalDate)).toISOString(),
      contentLength: content.length
    });

    // Get thread messages for context
    const threadMessages = await getThreadMessages(auth, threadId);

    // Only process if this is the latest message in thread
    const isLatestMessage = threadMessages && 
      threadMessages[0].id === message.data.id;

    if (!isLatestMessage) {
      logger.info('Skipping non-latest message in thread', {
        messageId,
        threadId,
        messageDate: new Date(parseInt(message.data.internalDate)).toISOString(),
        latestDate: threadMessages?.[0].date
      });
      processedMessages.add(messageId);
      return true;
    }

    // Extract and validate image attachments
    const imageAttachments = await extractImageAttachments(auth, message.data);
    const hasValidImages = imageAttachments.length > 0;

    logger.debug('Processing message with OpenAI', {
      messageId,
      hasThread: !!threadMessages,
      threadLength: threadMessages?.length,
      hasImages: hasValidImages,
      imageCount: imageAttachments.length
    });

    // Process with OpenAI
    const result = await classifyAndProcessEmail(
      content,
      senderEmail,
      threadMessages,
      hasValidImages ? imageAttachments : null,
      senderInfo
    );

    // Log to sheets
    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      clientId: message.data.id,
      conversationId: threadId,
      duration: 0,
      messageCount: 1,
      imageCount: imageAttachments.length,
      hasImages: imageAttachments.length > 0,
      conversation: [{
        role: 'user',
        content: content,
        timestamp: new Date(parseInt(message.data.internalDate)).toISOString()
      }],
      metadata: {
        type: 'EMAIL',
        urgency: result.classification?.urgency || 'medium',
        labels: labels.join(', '),
        classification: result.classification
      }
    });

    // Create draft if a reply was generated
    if (result.generatedReply) {
      await createDraft(auth, {
        to: senderEmail,
        subject: `Re: ${subject}`,
        body: result.generatedReply,
        threadId
      });
    }

    // Mark message as processed
    processedMessages.add(messageId);

    return true;
  } catch (error) {
    logger.error('Error processing message:', {
      error: error.message,
      stack: error.stack,
      messageId
    });
    return false;
  }
}

export async function sendEmail(to, subject, body, threadId = null) {
  try {
    const auth = await getGmailAuth();
    
    // Create email content with proper MIME structure
    const email = [
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      `To: ${to}`,
      'From: Michelle Thompson <info@appraisily.com>',
      `Subject: ${subject}`,
      '',
      body
    ].join('\r\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
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
      threadId: result.data.threadId,
      timestamp: new Date().toISOString()
    });

    // Mark our sent message as processed
    if (result.data.threadId && result.data.id) {
      processedMessages.add(result.data.id);
    }

    return {
      success: true,
      messageId: result.data.id,
      threadId: result.data.threadId
    };
  } catch (error) {
    logger.error('Failed to send email:', {
      error: error.message,
      stack: error.stack,
      to,
      subject,
      hasThreadId: !!threadId
    });
    throw error;
  }
}