import monitoring from '@google-cloud/monitoring';
import { logger } from './logger.js';

const client = new monitoring.MetricServiceClient();

export async function recordMetric(name, value = 1) {
  try {
    const projectPath = client.projectPath(process.env.PROJECT_ID);
    const now = new Date();

    const timeSeriesData = {
      metric: {
        type: `custom.googleapis.com/gmail_processor/${name}`,
        labels: {
          project_id: process.env.PROJECT_ID
        }
      },
      resource: {
        type: 'global',
        labels: {
          project_id: process.env.PROJECT_ID
        }
      },
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

    logger.debug(`Metric ${name} recorded`, { value });
  } catch (error) {
    logger.error(`Error recording metric ${name}:`, error);
  }
}