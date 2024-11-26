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

export async function extractImageAttachments(auth, message) {
  const attachments = [];

  try {
    if (!message.payload.parts) {
      return attachments;
    }

    for (const part of message.payload.parts) {
      if (part.mimeType && SUPPORTED_IMAGE_TYPES.includes(part.mimeType) && part.body.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          auth,
          userId: 'me',
          messageId: message.id,
          id: part.body.attachmentId
        });

        if (attachment.data.data) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            buffer: Buffer.from(attachment.data.data, 'base64')
          });
        }
      }
    }

    logger.debug('Extracted image attachments', {
      messageId: message.id,
      count: attachments.length
    });

    return attachments;
  } catch (error) {
    logger.error('Error extracting image attachments:', error);
    return attachments;
  }
}