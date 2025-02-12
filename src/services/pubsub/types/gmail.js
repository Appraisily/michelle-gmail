/**
 * @typedef {Object} GmailNotification
 * @property {string} emailAddress Email address
 * @property {string} historyId Gmail history ID
 */

/**
 * @typedef {Object} GmailMessage
 * @property {string} messageId Message ID
 * @property {string} threadId Thread ID
 * @property {string} [subject] Email subject
 * @property {string} [from] Sender email
 * @property {string} [content] Email content
 * @property {Array<Object>} [attachments] Email attachments
 */