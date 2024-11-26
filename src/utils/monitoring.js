import monitoring from '@google-cloud/monitoring';
import { logger } from './logger.js';
import pThrottle from 'p-throttle';
import { LRUCache } from 'lru-cache';

const client = new monitoring.MetricServiceClient();

// Cache metric writes to prevent duplicates
const metricsCache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 // 1 minute
});

// Throttle metric recording to max 1 per second per metric
const throttledRecord = pThrottle({
  limit: 1,
  interval: 1000
});

export const recordMetric = throttledRecord(async (name, value = 1) => {
  try {
    const cacheKey = `${name}-${Date.now()}`;
    if (metricsCache.has(cacheKey)) {
      return;
    }

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
    metricsCache.set(cacheKey, true);
  } catch (error) {
    logger.error(`Error recording metric ${name}:`, error);
  }
});