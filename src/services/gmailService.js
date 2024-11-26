<command>// ... rest of the imports remain the same

async function processMessage(auth, messageId) {
  // Skip if message was already processed
  if (processedMessages.has(messageId)) {
    logger.info('Skipping already processed message', { messageId });
    return true;
  }

  try {
    const message = await gmail.users.messages.get({
      auth,
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const headers = message.data.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value;
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value;
    const content = parseEmailContent(message.data.payload);
    const threadId = message.data.threadId;

    // Extract email address
    const emailMatch = from.match(/<([^>]+)>/) || [null, from.split(' ').pop()];
    const senderEmail = emailMatch[1];

    logger.info('Processing email', {
      messageId: message.data.id,
      threadId,
      subject,
      from
    });

    // Get thread messages for context
    const threadMessages = await getThreadMessages(auth, threadId);

    // Check for image attachments
    const imageAttachments = await processImageAttachments(auth, message.data);

    // Only process if this is the latest message in the thread
    const isLatestMessage = threadMessages && 
      threadMessages[threadMessages.length - 1].messageId === message.data.id;

    if (!isLatestMessage) {
      logger.info('Skipping non-latest message in thread', {
        messageId,
        threadId
      });
      processedMessages.add(messageId); // Mark as processed
      return true;
    }

    // Process with OpenAI - Always trigger for latest messages
    const result = await classifyAndProcessEmail(
      content,
      senderEmail,
      threadMessages,
      imageAttachments
    );

    // Log to sheets
    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      messageId: message.data.id,
      sender: from,
      subject,
      requiresReply: result.requiresReply,
      reply: result.generatedReply || 'No reply needed',
      reason: result.reason,
      analysis: result.analysis,
      responseData: result.responseData,
      hasImages: imageAttachments ? imageAttachments.length : 0
    });

    // Mark message as processed
    processedMessages.add(messageId);

    // Maintain a reasonable size for the Set
    if (processedMessages.size > 1000) {
      const oldestMessages = Array.from(processedMessages).slice(0, 500);
      oldestMessages.forEach(id => processedMessages.delete(id));
    }

    return true;
  } catch (error) {
    logger.error('Error processing message:', error);
    return false;
  }
}

export async function handleWebhook(data) {
  try {
    const auth = await getGmailAuth();
    const decodedData = JSON.parse(Buffer.from(data.message.data, 'base64').toString());
    
    if (!decodedData.historyId) {
      throw new Error('No historyId in notification');
    }

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      await initializeHistoryId(auth);
    }

    const history = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded', 'messageModified'] // Only process new/modified messages
    });

    if (!history.data.history) {
      logger.info('No new history events to process');
      return;
    }

    // Process new messages
    for (const item of history.data.history) {
      if (!item.messages) continue;

      logger.info('Processing history item', {
        historyId: item.id,
        messageCount: item.messages.length
      });

      const processPromises = item.messages.map(message => 
        processMessage(auth, message.id)
      );

      await Promise.all(processPromises);
    }

    // Update lastHistoryId after successful processing
    lastHistoryId = decodedData.historyId;
    logger.info('Updated history ID', { historyId: lastHistoryId });

  } catch (error) {
    logger.error('Webhook processing failed:', error);
    throw error;
  }
}