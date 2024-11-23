// Previous imports remain the same...

async function processNewMessages(notificationHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    logger.info('Starting message processing', { 
      lastHistoryId: lastHistoryId || 'not_set',
      notificationHistoryId,
      hasLastHistoryId: !!lastHistoryId
    });

    if (!notificationHistoryId || isNaN(parseInt(notificationHistoryId))) {
      logger.error('Invalid notification historyId', { 
        receivedHistoryId: notificationHistoryId 
      });
      return 0;
    }

    // If no lastHistoryId, initialize from current state
    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({ 
        auth,
        userId: 'me' 
      });
      lastHistoryId = profile.data.historyId;
      logger.info('Initialized lastHistoryId', { 
        lastHistoryId,
        notificationHistoryId
      });
      return 0;
    }

    let historyResponse;
    try {
      logger.info('Fetching history', {
        startHistoryId: lastHistoryId,
        notificationHistoryId
      });

      historyResponse = await gmail.users.history.list({
        auth,
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded', 'labelsAdded']
      });

      logger.info('History response details', {
        hasHistory: !!historyResponse.data.history,
        historyCount: historyResponse.data.history?.length || 0,
        nextPageToken: !!historyResponse.data.nextPageToken,
        startHistoryId: lastHistoryId,
        notificationHistoryId,
        rawResponse: JSON.stringify(historyResponse.data)
      });

    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('History ID not found - resetting', { 
          lastHistoryId,
          notificationHistoryId,
          error: error.message 
        });
        const profile = await gmail.users.getProfile({ 
          auth,
          userId: 'me' 
        });
        lastHistoryId = profile.data.historyId;
        logger.info('Reset lastHistoryId', {
          oldHistoryId: lastHistoryId,
          newHistoryId: profile.data.historyId,
          notificationHistoryId
        });
        return 0;
      }
      throw error;
    }

    if (!historyResponse.data.history) {
      logger.info('No history entries found', {
        lastHistoryId,
        notificationHistoryId
      });
      return 0;
    }

    let processedCount = 0;
    for (const history of historyResponse.data.history) {
      logger.info('Processing history entry', {
        historyId: history.id,
        lastHistoryId,
        notificationHistoryId,
        messageCount: history.messagesAdded?.length || 0,
        labelCount: history.labelsAdded?.length || 0,
        rawHistory: JSON.stringify(history)
      });

      if (!history.messagesAdded) {
        logger.info('No messages in history entry', {
          historyId: history.id,
          historyType: Object.keys(history).join(', ')
        });
        continue;
      }

      for (const messageAdded of history.messagesAdded) {
        try {
          if (!messageAdded.message) {
            logger.warn('Empty message in messagesAdded', {
              historyId: history.id,
              rawMessageAdded: JSON.stringify(messageAdded)
            });
            continue;
          }

          logger.info('Processing new message', { 
            messageId: messageAdded.message.id,
            threadId: messageAdded.message.threadId,
            historyId: history.id,
            labelIds: messageAdded.message.labelIds,
            rawMessage: JSON.stringify(messageAdded.message)
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: messageAdded.message.id,
            format: 'full'
          });

          logger.info('Retrieved full message data', {
            messageId: messageData.data.id,
            threadId: messageData.data.threadId,
            historyId: history.id,
            snippet: messageData.data.snippet,
            hasPayload: !!messageData.data.payload,
            labelIds: messageData.data.labelIds,
            rawHeaders: JSON.stringify(messageData.data.payload?.headers)
          });

          const headers = messageData.data.payload?.headers || [];
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Parsed email content', {
            messageId: emailContent.id,
            threadId: emailContent.threadId,
            subject: emailContent.subject,
            from: emailContent.from,
            historyId: history.id,
            bodyLength: emailContent.body.length,
            hasBody: !!emailContent.body
          });

          // Rest of the processing remains the same...
          
          processedCount++;
          recordMetric('emails_processed', 1);
        } catch (error) {
          logger.error('Message processing failed', {
            messageId: messageAdded.message?.id,
            threadId: messageAdded.message?.threadId,
            historyId: history.id,
            error: error.message,
            stack: error.stack
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

    if (processedCount > 0) {
      const oldHistoryId = lastHistoryId;
      lastHistoryId = notificationHistoryId;
      logger.info('Updated lastHistoryId', {
        oldHistoryId,
        newHistoryId: lastHistoryId,
        processedCount
      });
    }

    return processedCount;
  } catch (error) {
    logger.error('History processing failed', {
      lastHistoryId,
      notificationHistoryId,
      error: error.message,
      stack: error.stack
    });
    recordMetric('email_fetch_failures', 1);
    throw error;
  }
}

// Rest of the file remains the same...