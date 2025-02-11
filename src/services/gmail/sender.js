import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';

const gmail = google.gmail('v1');

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