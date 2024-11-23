import monitoring from '@google-cloud/monitoring';
import { logger } from './logger.js';

const MonitoringServiceClient = monitoring.v3.MetricServiceClient;
const client = new MonitoringServiceClient();

// Metric values cache
const metricValues = new Map();
const metricStartTimes = new Map();

const metrics = {
  'emails_processed': createMetric('emails_processed'),
  'email_classifications': createMetric('email_classifications'),
  'replies_generated': createMetric('replies_generated'),
  'replies_sent': createMetric('replies_sent'),
  'processing_failures': createMetric('processing_failures'),
  'openai_failures': createMetric('openai_failures'),
  'gmail_watch_renewals': createMetric('gmail_watch_renewals'),
  'gmail_watch_renewal_failures': createMetric('gmail_watch_renewal_failures'),
  'email_fetch_failures': createMetric('email_fetch_failures'),
  'reply_failures': createMetric('reply_failures')
};

function createMetric(name) {
  return {
    type: `custom.googleapis.com/gmail_processor/${name}`,
    resource: {
      type: 'global',
      labels: {
        project_id: process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID
      }
    }
  };
}

export async function setupMetrics() {
  const projectPath = client.projectPath(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID);

  for (const [metricName, metric] of Object.entries(metrics)) {
    try {
      const descriptor = {
        name: metric.type,
        displayName: metricName,
        type: 'custom.googleapis.com/gmail_processor/' + metricName,
        metricKind: 'GAUGE',
        valueType: 'INT64',
        unit: '1',
        description: `Tracks ${metricName.replace(/_/g, ' ')}`,
        labels: [{
          key: 'project_id',
          valueType: 'STRING',
          description: 'The ID of the GCP project'
        }]
      };

      await client.createMetricDescriptor({
        name: projectPath,
        metricDescriptor: descriptor
      });

      // Initialize metric value and start time
      metricValues.set(metricName, 0);
      metricStartTimes.set(metricName, new Date());

    } catch (error) {
      // Ignore errors if metric descriptor already exists
      if (!error.message.includes('ALREADY_EXISTS')) {
        logger.error(`Error creating metric ${metricName}:`, error);
      }
    }
  }
}

export async function recordMetric(metricName, value = 1) {
  if (!metrics[metricName]) {
    logger.warn(`Unknown metric: ${metricName}`);
    return;
  }

  try {
    // Update value
    metricValues.set(metricName, value);

    const projectPath = client.projectPath(process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID);
    const now = new Date();

    const timeSeriesData = {
      metric: metrics[metricName],
      points: [{
        interval: {
          endTime: {
            seconds: Math.floor(now.getTime() / 1000)
          }
        },
        value: {
          int64Value: value
        }
      }]
    };

    await client.createTimeSeries({
      name: projectPath,
      timeSeries: [timeSeriesData]
    });

    logger.debug(`Metric ${metricName} recorded successfully`, { value });
  } catch (error) {
    logger.error(`Error recording metric ${metricName}:`, error);
    // Don't throw the error to prevent breaking the main flow
  }
}