export const PUBSUB_CONFIG = {
  topics: {
    gmail: 'gmail-notifications',
    crm: process.env.PUBSUB_CRM_NAME || 'crm-interactions'
  },
  subscriptions: {
    gmail: 'gmail-notifications-sub',
    crm: `${process.env.PUBSUB_CRM_NAME || 'crm-interactions'}-sub`
  },
  retrySettings: {
    maxAttempts: 5,
    initialRetryDelay: 1000,
    maxRetryDelay: 60000
  },
  orderingEnabled: true,
  deadLetterPolicy: {
    deadLetterTopic: `${process.env.PUBSUB_CRM_NAME || 'crm-interactions'}-failed`,
    maxDeliveryAttempts: 5
  }
};