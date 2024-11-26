import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

const gmail = google.gmail('v1');

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic'
];

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export async function extractImageAttachments(auth, message) {
  const attachments = [];
  let totalSize = 0;

  try {
    if (!message.payload?.parts) {
      logger.debug('No message parts found', { messageId: message.id });
      return attachments;
    }

    for (const part of message.payload.parts) {
      if (!isValidImageAttachment(part)) {
        continue;
      }

      try {
        const attachment = await gmail.users.messages.attachments.get({
          auth,
          userId: 'me',
          messageId: message.id,
          id: part.body.attachmentId
        });

        if (!attachment.data?.data) {
          logger.warn('Empty attachment data', {
            messageId: message.id,
            filename: part.filename,
            mimeType: part.mimeType
          });
          continue;
        }

        const buffer = Buffer.from(attachment.data.data, 'base64');
        
        // Check attachment size
        if (buffer.length > MAX_IMAGE_SIZE) {
          logger.warn('Image attachment too large', {
            messageId: message.id,
            filename: part.filename,
            size: buffer.length,
            maxSize: MAX_IMAGE_SIZE
          });
          continue;
        }

        totalSize += buffer.length;

        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          buffer,
          size: buffer.length
        });

        logger.debug('Image attachment processed', {
          messageId: message.id,
          filename: part.filename,
          mimeType: part.mimeType,
          size: buffer.length
        });
      } catch (error) {
        logger.error('Error processing attachment', {
          error: error.message,
          messageId: message.id,
          filename: part.filename,
          stack: error.stack
        });
      }
    }

    logger.info('Image attachments extracted', {
      messageId: message.id,
      count: attachments.length,
      totalSize,
      filenames: attachments.map(a => a.filename)
    });

    return attachments;
  } catch (error) {
    logger.error('Error extracting image attachments:', {
      error: error.message,
      messageId: message.id,
      stack: error.stack
    });
    return attachments;
  }
}

function isValidImageAttachment(part) {
  if (!part.mimeType || !SUPPORTED_IMAGE_TYPES.includes(part.mimeType)) {
    return false;
  }

  if (!part.body?.attachmentId) {
    return false;
  }

  if (!part.filename) {
    return false;
  }

  return true;
}