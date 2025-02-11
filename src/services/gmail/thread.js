import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

const gmail = google.gmail('v1');
const MAX_THREAD_DEPTH = 10;
const THREAD_CACHE = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches and processes thread messages with caching
 */
export async function getThreadMessages(auth, threadId, messageId = null) {
  try {
    // Check cache first
    const cached = THREAD_CACHE.get(threadId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      logger.debug('Using cached thread messages', {
        threadId,
        messageCount: cached.messages.length
      });
      return cached.messages;
    }

    // Fetch thread
    const thread = await gmail.users.threads.get({
      auth,
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    // Process messages
    const messages = await processThreadMessages(thread.data.messages);

    // Cache results
    THREAD_CACHE.set(threadId, {
      messages,
      timestamp: Date.now()
    });

    // Clean up old cache entries
    cleanupCache();

    logger.info('Thread messages retrieved', {
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

/**
 * Process thread messages with proper sorting and formatting
 */
async function processThreadMessages(messages) {
  return messages
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
}

/**
 * Parse email content from payload
 */
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
      .replace(/[\n\s]+$/g, '\n')
      .trim();

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

/**
 * Clean up old cache entries
 */
function cleanupCache() {
  const now = Date.now();
  for (const [threadId, data] of THREAD_CACHE.entries()) {
    if (now - data.timestamp > CACHE_TTL) {
      THREAD_CACHE.delete(threadId);
      logger.debug('Cleaned up thread cache entry', { threadId });
    }
  }
}

/**
 * Check if message is latest in thread
 */
export function isLatestMessage(threadMessages, messageId) {
  return threadMessages && 
         threadMessages.length > 0 && 
         threadMessages[0].id === messageId;
}

/**
 * Format thread context for OpenAI
 */
export function formatThreadContext(threadMessages) {
  if (!threadMessages || threadMessages.length === 0) {
    return '';
  }

  return threadMessages
    .map(msg => {
      const role = msg.isIncoming ? 'Customer' : 'Appraisily';
      return `[${msg.date}] ${role}:\n${msg.content.trim()}\n`;
    })
    .join('\n---\n\n');
}

// Export cache for testing
export const __threadCache = THREAD_CACHE;