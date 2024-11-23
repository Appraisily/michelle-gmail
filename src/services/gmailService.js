async function processNewMessages(notificationHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    logger.info('Processing messages', { 
      lastHistoryId: lastHistoryId || 'not_set',
      notificationHistoryId: notificationHistoryId || 'not_provided',
      hasLastHistoryId: !!lastHistoryId
    });

    if (!notificationHistoryId || isNaN(parseInt(notificationHistoryId))) {
      logger.error('Invalid notification historyId', { 
        receivedHistoryId: notificationHistoryId 
      });
      return 0;
    }

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({ 
        auth,
        userId: 'me' 
      });
      lastHistoryId = profile.data.historyId;
      logger.info('Initialized history ID', { 
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
        historyTypes: ['messageAdded']
      });

      // Log raw response for debugging
      logger.info('Raw history response', {
        hasHistory: !!historyResponse.data.history,
        historyCount: historyResponse.data.history?.length || 0,
        nextPageToken: historyResponse.data.nextPageToken,
        startHistoryId: lastHistoryId,
        notificationHistoryId,
        responseData: JSON.stringify(historyResponse.data)
      });

    } catch (error) {
      if (error.response?.status === 404) {
        logger.error('History ID not found', { 
          lastHistoryId,
          notificationHistoryId,
          error: error.message 
        });
        const profile = await gmail.users.getProfile({ 
          auth,
          userId: 'me' 
        });
        lastHistoryId = profile.data.historyId;
        logger.info('Reset history ID', {
          oldHistoryId: lastHistoryId,
          newHistoryId: profile.data.historyId,
          notificationHistoryId
        });
        return 0;
      }
      throw error;
    }

    if (!historyResponse.data.history) {
      logger.info('No history entries', {
        lastHistoryId,
        notificationHistoryId,
        responseData: JSON.stringify(historyResponse.data)
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
        messages: history.messagesAdded?.map(m => ({
          id: m.message.id,
          threadId: m.message.threadId,
          labelIds: m.message.labelIds
        })) || []
      });

      for (const message of history.messagesAdded || []) {
        try {
          logger.info('Processing message', {
            messageId: message.message.id,
            threadId: message.message.threadId,
            historyId: history.id,
            labelIds: message.message.labelIds,
            raw: JSON.stringify(message)
          });

          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: message.message.id,
            format: 'full'
          });

          const headers = messageData.data.payload.headers;
          const emailContent = {
            id: messageData.data.id,
            threadId: messageData.data.threadId,
            subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject',
            from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
            body: messageData.data.snippet || ''
          };

          logger.info('Message details', {
            messageId: emailContent.id,
            threadId: emailContent.threadId,
            subject: emailContent.subject,
            from: emailContent.from,
            historyId: history.id,
            labelIds: messageData.data.labelIds,
            bodyLength: emailContent.body.length,
            hasBody: !!emailContent.body
          });

          const { requiresReply, generatedReply } = await classifyAndProcessEmail(emailContent.body);
          
          if (requiresReply) {
            logger.info('Generating reply', {
              messageId: emailContent.id,
              threadId: emailContent.threadId,
              historyId: history.id
            });

            const replyMessage = {
              userId: 'me',
              resource: {
                raw: Buffer.from(
                  `To: ${emailContent.from}\r\n` +
                  `Subject: Re: ${emailContent.subject}\r\n` +
                  `In-Reply-To: ${emailContent.id}\r\n` +
                  `References: ${emailContent.id}\r\n` +
                  `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
                  `${generatedReply}`
                ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
              },
              threadId: emailContent.threadId
            };

            const sentResponse = await gmail.users.messages.send({
              auth,
              userId: 'me',
              resource: replyMessage
            });

            logger.info('Reply sent', {
              originalMessageId: emailContent.id,
              replyMessageId: sentResponse.data.id,
              threadId: emailContent.threadId,
              historyId: history.id
            });

            recordMetric('replies_sent', 1);
          }

          await logEmailProcessing({
            timestamp: new Date().toISOString(),
            sender: emailContent.from,
            subject: emailContent.subject,
            content: emailContent.body,
            requiresReply,
            reply: generatedReply || 'No reply needed',
            messageId: emailContent.id,
            threadId: emailContent.threadId,
            historyId: history.id
          });

          processedCount++;
          recordMetric('emails_processed', 1);
        } catch (error) {
          logger.error('Message processing failed', {
            messageId: message.message.id,
            threadId: message.message.threadId,
            historyId: history.id,
            error: error.message,
            stack: error.stack
          });
          recordMetric('processing_failures', 1);
        }
      }
    }

    // Update lastHistoryId after successful processing
    if (processedCount > 0) {
      const oldHistoryId = lastHistoryId;
      lastHistoryId = notificationHistoryId;
      logger.info('Updated history ID', {
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

export async function handleWebhook(data) {
  logger.info('Webhook received', {
    notificationHistoryId: data.historyId,
    lastHistoryId,
    emailAddress: data.emailAddress,
    rawData: JSON.stringify(data)
  });
  
  const startTime = Date.now();

  try {
    const processedCount = await processNewMessages(data.historyId);
    
    const processingTime = Date.now() - startTime;
    logger.info('Webhook completed', {
      processedCount,
      processingTime,
      notificationHistoryId: data.historyId,
      lastHistoryId,
      success: true
    });
  } catch (error) {
    logger.error('Webhook failed', {
      notificationHistoryId: data.historyId,
      lastHistoryId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}