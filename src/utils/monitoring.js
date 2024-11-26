import monitoring from '@google-cloud/monitoring';
import pThrottle from 'p-throttle';
import { LRUCache } from 'lru-cache';
import { logger } from './logger.js';

const client = new monitoring.MetricServiceClient();

// Cache metric writes to prevent duplicates within a time window
const metricsCache = new LRUCache({
  max: 1000, // Store up to 1000 metric entries
  ttl: 1000 * 60 // Cache for 1 minute
});

// Throttle metric recording to max 1 per minute per metric name
const throttledRecord = pThrottle({
  limit: 1,
  interval: 60 * 1000 // 1 minute
});

export const recordMetric = throttledRecord(async (name, value = 1) => {
  try {
    // Create cache key using metric name and current minute
    const cacheKey = `${name}-${Math.floor(Date.now() / 60000)}`;
    
    // Skip if already recorded in this minute
    if (metricsCache.has(cacheKey)) {
      logger.debug('Skipping duplicate metric', { name, value, cacheKey });
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

    // Cache the metric write
    metricsCache.set(cacheKey, true);

    logger.debug('Metric recorded successfully', { 
      name, 
      value,
      timestamp: now.toISOString()
    });

  } catch (error) {
    logger.error('Error recording metric:', {
      error: error.message,
      metric: name,
      value
    });
  }
});