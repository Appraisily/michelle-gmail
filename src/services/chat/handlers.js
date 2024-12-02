// Previous imports remain the same...
import { getCurrentTimestamp, getTimeDifference } from './utils/timeUtils.js';

// Rest of the code remains the same until the handleMessage function...

export async function handleMessage(ws, data, client) {
  try {
    // Verify connection state
    if (ws.readyState !== ConnectionState.OPEN) {
      logger.warn('Attempted to handle message on non-open connection', {
        clientId: client?.id,
        readyState: ws.readyState,
        timestamp: getCurrentTimestamp()
      });
      return;
    }

    const message = JSON.parse(data);

    // Update client state for ALL message types
    client.lastMessage = Date.now();

    // Handle system messages
    if (message.type === MessageType.PING || 
        message.type === MessageType.PONG || 
        message.type === MessageType.STATUS) {
      // Just confirm receipt for system messages
      await connectionManager.sendMessage(ws, {
        type: MessageType.CONFIRM,
        clientId: client.id,
        messageId: message.messageId,
        status: 'received',
        timestamp: getCurrentTimestamp()
      });
      return;
    }

    // Rest of the code remains the same, but replace all instances of
    // new Date().toISOString() with getCurrentTimestamp()
    // ...
  } catch (error) {
    await handleMessageError(ws, error, client, message?.messageId);
  }
}