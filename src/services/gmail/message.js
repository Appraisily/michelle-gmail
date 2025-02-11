import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { classifyAndProcessEmail } from '../openai/index.js';
import { logEmailProcessing } from '../sheets/index.js';
import { extractImageAttachments } from './attachments.js';
import { shouldProcessMessage } from './utils/messageFilters.js';
import { getThreadMessages, isLatestMessage } from './thread.js';
import { createDraft } from './drafts.js';

const gmail = google.gmail('v1');
const processedMessages = new Set();

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

    const messageData = extractMessageData(message.data);
    logger.debug('Processing email message', messageData);

    // Get thread messages for context
    const threadMessages = await getThreadMessages(auth, threadId);

    // Only process if this is the latest message in thread
    if (!isLatestMessage(threadMessages, messageId)) {
      logger.info('Skipping non-latest message in thread', {
        messageId,
        threadId,
        messageDate: messageData.date,
        latestDate: threadMessages?.[0].date
      });
      processedMessages.add(messageId);
      return true;
    }

    // Process message content
    const result = await processMessageContent(auth, message.data, messageData, threadMessages);

    // Mark message as processed
    processedMessages.add(messageId);
    cleanupProcessedMessages();

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

function extractMessageData(message) {
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value;
  const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
  const labels = message.labelIds || [];

  // Extract sender info
  const emailMatch = from.match(/<([^>]+)>/) || [null, from.split(' ').pop()];
  const senderEmail = emailMatch[1];
  const senderName = from.replace(/<.*>/, '').trim();

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    from,
    senderInfo: { name: senderName, email: senderEmail },
    labels,
    date: new Date(parseInt(message.internalDate)).toISOString()
  };
}

async function processMessageContent(auth, message, messageData, threadMessages) {
  // Extract and validate image attachments
  const imageAttachments = await extractImageAttachments(auth, message);
  const hasValidImages = imageAttachments.length > 0;

  logger.debug('Processing message with OpenAI', {
    messageId: messageData.id,
    hasThread: !!threadMessages,
    threadLength: threadMessages?.length,
    hasImages: hasValidImages,
    imageCount: imageAttachments.length
  });

  // Process with OpenAI
  const result = await classifyAndProcessEmail(
    message.payload.body.data,
    messageData.senderInfo.email,
    threadMessages,
    hasValidImages ? imageAttachments : null,
    messageData.senderInfo
  );

  // Log to sheets
  await logEmailProcessing({
    timestamp: new Date().toISOString(),
    clientId: messageData.id,
    conversationId: messageData.threadId,
    duration: 0,
    messageCount: 1,
    imageCount: imageAttachments.length,
    hasImages: imageAttachments.length > 0,
    conversation: [{
      role: 'user',
      content: message.payload.body.data,
      timestamp: messageData.date
    }],
    metadata: {
      type: 'EMAIL',
      urgency: result.classification?.urgency || 'medium',
      labels: messageData.labels.join(', '),
      classification: result.classification
    }
  });

  // Create draft if a reply was generated
  if (result.generatedReply) {
    await createDraft(auth, {
      to: messageData.senderInfo.email,
      subject: `Re: ${messageData.subject}`,
      body: result.generatedReply,
      threadId: messageData.threadId
    });
  }

  return result;
}

function cleanupProcessedMessages() {
  if (processedMessages.size > 1000) {
    const oldestMessages = Array.from(processedMessages).slice(0, 500);
    oldestMessages.forEach(id => processedMessages.delete(id));
  }
}