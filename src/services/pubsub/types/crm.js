/**
 * @typedef {Object} CRMMessage
 * @property {'EMAIL'|'CHAT'|'DIRECT'} type Message type
 * @property {Object} source Source information
 * @property {string} source.id Source identifier
 * @property {string} source.channel Source channel
 * @property {string} source.timestamp ISO timestamp
 * @property {Object} customer Customer information
 * @property {string} [customer.email] Customer email
 * @property {string} [customer.name] Customer name
 * @property {Object} [customer.metadata] Additional metadata
 * @property {Object} interaction Interaction details
 * @property {string} interaction.type Interaction type
 * @property {string} interaction.content Interaction content
 * @property {Object} [interaction.classification] AI classification
 * @property {string} interaction.classification.intent Intent
 * @property {string} interaction.classification.urgency Urgency level
 * @property {Array<Object>} [interaction.attachments] Attachments
 * @property {Object} [response] Response information
 * @property {string} response.content Response content
 * @property {string} response.type Response type
 * @property {Object} [response.metadata] Additional metadata
 */

/**
 * @typedef {Object} PublishOptions
 * @property {Object} [retrySettings] Retry configuration
 * @property {number} retrySettings.maxAttempts Maximum retry attempts
 * @property {number} retrySettings.initialRetryDelay Initial retry delay in ms
 * @property {number} retrySettings.maxRetryDelay Maximum retry delay in ms
 * @property {string} [orderingKey] Message ordering key
 * @property {Object} [attributes] Message attributes
 */

export const MessageType = {
  EMAIL: 'EMAIL',
  CHAT: 'CHAT',
  DIRECT: 'DIRECT'
};

export const ResponseType = {
  AUTO: 'auto',
  MANUAL: 'manual',
  SYSTEM: 'system'
};