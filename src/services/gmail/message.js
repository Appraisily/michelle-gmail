// Only showing the modified part of processMessage function
async function processMessage(auth, messageId) {
  // ... existing code ...

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
    const labels = message.data.labelIds || [];

    // Extract sender information
    const emailMatch = from.match(/<([^>]+)>/) || [null, from.split(' ').pop()];
    const senderEmail = emailMatch[1];
    const senderName = from.replace(/<.*>/, '').trim();

    const senderInfo = {
      name: senderName,
      email: senderEmail
    };

    logger.info('Processing email', {
      messageId: message.data.id,
      threadId,
      subject,
      sender: senderInfo,
      labels,
      timestamp: new Date(parseInt(message.data.internalDate)).toISOString()
    });

    // Get thread messages for context
    const threadMessages = await getThreadMessages(auth, threadId);

    // Only process if this is the latest message
    const isLatestMessage = threadMessages && 
      threadMessages[threadMessages.length - 1].timestamp === parseInt(message.data.internalDate);

    if (!isLatestMessage) {
      logger.info('Skipping non-latest message in thread', {
        messageId,
        threadId,
        messageDate: new Date(parseInt(message.data.internalDate)).toISOString(),
        latestDate: threadMessages?.[threadMessages.length - 1].date
      });
      processedMessages.add(messageId);
      return true;
    }

    // Extract image attachments
    const imageAttachments = await extractImageAttachments(auth, message.data);

    // Process with OpenAI
    const result = await classifyAndProcessEmail(
      content,
      senderEmail,
      threadMessages,
      imageAttachments,
      senderInfo // Pass sender information to OpenAI processing
    );

    // Log to sheets
    await logEmailProcessing({
      timestamp: new Date().toISOString(),
      messageId: message.data.id,
      sender: from,
      subject,
      hasImages: imageAttachments.length > 0,
      requiresReply: result.requiresReply,
      reply: result.generatedReply || 'No reply needed',
      reason: result.reason,
      classification: result.classification,
      threadId,
      labels: labels.join(', ')
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
    logger.error('Error processing message:', {
      error: error.message,
      stack: error.stack,
      messageId
    });
    return false;
  }
}