import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';
import { logEmailProcessing } from '../sheets/index.js';
import { extractImageAttachments } from './attachments.js';
import { classifyAndProcessEmail } from '../openai/index.js'; 
import { crmPublisher } from '../pubsub/index.js';
import { v4 as uuidv4 } from 'uuid';

export { processMessage, sendEmail };

const gmail = google.gmail('v1');

async function processMessage(auth, messageId) {
  const startTime = Date.now();

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
    const labels = message.data.labelIds || [];
    
    // Extract sender info
    const senderMatch = from.match(/^(?:([^<]*)<)?([^>]+)>?$/);
    const senderName = senderMatch ? senderMatch[1]?.trim() || '' : '';
    const senderEmail = senderMatch ? senderMatch[2]?.trim() || from : from;

    logger.info('Processing email', {
      messageId: message.data.id,
      threadId,
      subject,
      from,
      labels,
      timestamp: new Date(parseInt(message.data.internalDate)).toISOString()
    });

    // Extract image attachments
    const imageAttachments = await extractImageAttachments(auth, message.data);

    // Process with OpenAI
    const result = await classifyAndProcessEmail(
      content,
      senderEmail,
      null, // No thread messages for now
      imageAttachments
    );

    // Log to sheets
    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      messageId: message.data.id,
      threadId,
      sender: from,
      subject,
      content,
      hasImages: imageAttachments.length > 0,
      imageCount: imageAttachments.length,
      classification: result.classification,
      requiresReply: result.requiresReply,
      generatedReply: result.generatedReply,
      imageAnalysis: result.imageAnalysis,
      processingTime: Date.now() - startTime,
      labels: labels.join(', '),
      status: 'Processed',
      error: null
    });

    // Prepare and publish CRM message
    const crmMessage = {
      crmProcess: "gmailInteraction",
      customer: {
        email: senderEmail,
        name: senderName
      },
      email: {
        messageId: message.data.id,
        threadId,
        subject,
        content: content.substring(0, 1000), // Truncate long content
        timestamp: new Date(parseInt(message.data.internalDate)).toISOString(),
        classification: {
          intent: result.classification.intent,
          urgency: result.classification.urgency,
          responseType: result.classification.suggestedResponseType,
          requiresReply: result.requiresReply
        },
        attachments: {
          hasImages: imageAttachments.length > 0,
          imageCount: imageAttachments.length,
          imageAnalysis: result.imageAnalysis
        },
        response: {
          generated: result.generatedReply,
          status: "pending"
        }
      },
      metadata: {
        origin: "gmail",
        labels,
        processingTime: Date.now() - startTime,
        timestamp: Date.now(),
        status: "processed",
        error: null
      }
    };

    await crmPublisher.publish(crmMessage);

    logger.info('CRM message published for email', {
      messageId: message.data.id,
      threadId,
      timestamp: new Date().toISOString()
    });

    return true;
  } catch (error) {
    logger.error('Error processing message:', {
      error: error.message,
      stack: error.stack,
      messageId
    });

    // Log error to sheets
    try {
      await logEmailProcessing({
        timestamp: new Date().toISOString(),
        messageId,
        threadId: message?.data?.threadId,
        sender: message?.data?.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value || '',
        subject: message?.data?.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || '',
        processingTime: Date.now() - startTime,
        status: 'Error',
        error: error.message
      });

      // Send error notification to CRM
      const crmErrorMessage = {
        crmProcess: "gmailInteraction",
        customer: {
          email: "unknown",
          name: "unknown"
        },
        email: {
          messageId,
          threadId: message?.data?.threadId,
          timestamp: new Date().toISOString()
        },
        metadata: {
          origin: "gmail",
          status: "error",
          error: error.message,
          timestamp: Date.now()
        }
      };

      await crmPublisher.publish(crmErrorMessage);

    } catch (logError) {
      logger.error('Error logging processing failure:', {
        error: logError.message,
        originalError: error.message,
        messageId
      });
    }

    return false;
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

    return content.trim();
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

async function sendEmail(to, subject, body, threadId = null) {
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