import { logger } from '../../utils/logger.js';

export const HEARTBEAT_INTERVAL = 60000; // 60 seconds

export function setupHeartbeat(wss, clients) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = clients.get(ws);
      if (!client) {
        return ws.terminate();
      }

      if (client.isAlive === false) {
        logger.info('Terminating inactive client', {
          clientId: client.id,
          conversationId: client.conversationId,
          lastMessage: new Date(client.lastMessage).toISOString()
        });
        clients.delete(ws);
        return ws.terminate();
      }

      client.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  return interval;
}