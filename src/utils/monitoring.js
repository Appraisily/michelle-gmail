import monitoring from '@google-cloud/monitoring';
const MonitoringServiceClient = monitoring.v3.MetricServiceClient;

const client = new MonitoringServiceClient();

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
        project_id: process.env.PROJECT_ID
      }
    }
  };
}

export async function setupMetrics() {
  const projectPath = client.projectPath(process.env.PROJECT_ID);

  for (const [metricName, metric] of Object.entries(metrics)) {
    try {
      const descriptor = {
        name: metric.type,
        displayName: metricName,
        type: 'custom.googleapis.com/gmail_processor/' + metricName,
        metricKind: 'GAUGE',
        valueType: 'INT64',
        unit: '1',
        description: `Tracks ${metricName.replace(/_/g, ' ')}`
      };

      await client.createMetricDescriptor({
        name: projectPath,
        metricDescriptor: descriptor
      });
    } catch (error) {
      console.error(`Error creating metric ${metricName}:`, error);
    }
  }
}

export async function recordMetric(metricName, value) {
  if (!metrics[metricName]) {
    throw new Error(`Unknown metric: ${metricName}`);
  }

  try {
    const projectPath = client.projectPath(process.env.PROJECT_ID);
    const timeSeriesData = {
      metric: metrics[metricName],
      points: [{
        interval: {
          endTime: {
            seconds: Math.floor(Date.now() / 1000)
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
  } catch (error) {
    console.error(`Error recording metric ${metricName}:`, error);
  }
}