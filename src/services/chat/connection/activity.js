import { logger } from '../../../utils/logger.js';
import { MessageType } from './types.js';

const SYSTEM_MESSAGE_TYPES = [
  MessageType.PING,
  MessageType.PONG,
  MessageType.CONFIRM,
  MessageType.STATUS
];

/**
 * Activity tracker for WebSocket connections
 */
export class ActivityTracker {
  constructor() {
    this.activities = new Map();
  }

  /**
   * Update connection activity timestamp
   * @param {string} clientId Client identifier
   * @param {string} type Activity type
   */
  updateActivity(clientId, type) {
    const now = Date.now();
    const activity = this.activities.get(clientId) || {
      lastActivity: now,
      lastMessage: now,
      lastPong: now
    };

    activity.lastActivity = now;

    // Update lastMessage for non-system messages
    if (this.isUserActivity(type)) {
      activity.lastMessage = now;
    }

    // Update lastPong for heartbeat responses
    if (type === MessageType.PONG) {
      activity.lastPong = now;
    }

    this.activities.set(clientId, activity);

    logger.debug('Activity updated', {
      clientId,
      type,
      timestamp: new Date(now).toISOString()
    });
  }

  /**
   * Get last activity timestamp
   * @param {string} clientId Client identifier
   * @returns {Object} Activity timestamps
   */
  getLastActivity(clientId) {
    return this.activities.get(clientId) || null;
  }

  /**
   * Remove client activity tracking
   * @param {string} clientId Client identifier
   */
  removeClient(clientId) {
    this.activities.delete(clientId);
  }

  /**
   * Check if message type represents user activity
   * @param {string} type Message type
   * @returns {boolean} Whether type represents user activity
   */
  /**
   * Check if message type represents user activity
   * @param {string} type Message type
   * @returns {boolean} Whether type represents user activity
   */
  isUserActivity(type) {
    return !SYSTEM_MESSAGE_TYPES.includes(type);
  }
}

export const activityTracker = new ActivityTracker();