import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';

const gmail = google.gmail('v1');

export async function createDraft(auth, { to, subject, body, threadId }) {
  try {
    // Create email content with proper MIME structure
    const email = [
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
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

    const draft = await gmail.users.drafts.create({
      auth,
      userId: 'me',
      requestBody: {
        message: {
          raw: encodedEmail,
          ...(threadId && { threadId })
        }
      }
    });

    logger.info('Draft created successfully', {
      to,
      subject,
      threadId,
      draftId: draft.data.id,
      timestamp: new Date().toISOString()
    });

    return draft.data;
  } catch (error) {
    logger.error('Failed to create draft:', {
      error: error.message,
      stack: error.stack,
      to,
      subject,
      threadId
    });
    throw error;
  }
}