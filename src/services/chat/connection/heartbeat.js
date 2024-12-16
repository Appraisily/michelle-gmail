import { logger } from '../../../utils/logger.js';
import { activityTracker } from './activity.js';
import { MessageType, ConnectionState } from './types.js';

// Increased intervals for more lenient connection management
export const HEARTBEAT_INTERVAL = 60000; // 60 seconds
export const HEARTBEAT_TIMEOUT = 180000; // 3 minutes
export const INITIAL_GRACE_PERIOD = 60000; // 1 minute grace period

/**
 * Setup heartbeat monitoring for WebSocket server
 * @param {WebSocketServer} wss WebSocket server instance
 * @param {ConnectionManager} connectionManager Connection manager instance
 * @returns {NodeJS.Timer} Heartbeat interval
 */
export function setupHeartbeat(wss, connectionManager) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = connectionManager.getConnectionInfo(ws);
      
      if (!client) {
        logger.warn('Client without data found, terminating');
        return ws.terminate();
      }

      // Give new connections an initial grace period
      const connectionAge = Date.now() - client.connectedAt;
      if (connectionAge < INITIAL_GRACE_PERIOD) {
        client.isAlive = true;
        return;
      }

      // Check last activity time
      const activity = activityTracker.getLastActivity(client.id);
      if (!activity) {
        logger.warn('No activity data found for client', { clientId: client.id });
        return ws.terminate();
      }

      const lastActivityAge = Date.now() - activity.lastActivity;
      if (lastActivityAge > HEARTBEAT_TIMEOUT) {
        logger.info('Client exceeded heartbeat timeout', {
          clientId: client.id,
          lastActivityAge,
          timeout: HEARTBEAT_TIMEOUT
        });
        connectionManager.removeConnection(ws);
        return ws.terminate();
      }

      // Check if client missed last heartbeat
      if (client.isAlive === false) {
        logger.info('Terminating inactive client', {
          clientId: client.id,
          lastActivity: new Date(activity.lastActivity).toISOString(),
          inactiveTime: Date.now() - activity.lastActivity
        });
        
        connectionManager.removeConnection(ws);
        return ws.terminate();
      }

      // Mark as inactive until pong received
      client.isAlive = false;
      
      // Send ping with timestamp
      const pingMessage = {
        type: MessageType.PING,
        clientId: client.id,
        timestamp: new Date().toISOString()
      };
      
      if (ws.readyState === ConnectionState.OPEN) {
        ws.send(JSON.stringify(pingMessage), (err) => {
          if (err) {
            logger.error('Error sending ping', {
              error: err.message,
              clientId: client.id
            });
          }
        });
      }
    });
  }, HEARTBEAT_INTERVAL);

  logger.info('Heartbeat service initialized', {
    interval: HEARTBEAT_INTERVAL,
    timeout: HEARTBEAT_TIMEOUT,
    initialGracePeriod: INITIAL_GRACE_PERIOD
  });

  return interval;
}

/**
 * Handle pong response from client
 * @param {WebSocket} ws WebSocket connection
 * @param {Object} client Client data
 */
export function handlePong(ws, client) {
  if (client && ws.readyState === ConnectionState.OPEN) {
    client.isAlive = true;
    activityTracker.updateActivity(client.id, MessageType.PONG);
    
    logger.debug('Received pong from client', {
      clientId: client.id,
      timestamp: new Date().toISOString()
    });
  }
}