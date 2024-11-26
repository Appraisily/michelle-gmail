// ... (previous imports)

const processedMessages = new Set();
let lastHistoryId = null;

// Clean up old processed messages periodically
setInterval(() => {
  const oldestMessages = Array.from(processedMessages).slice(0, 500);
  oldestMessages.forEach(id => processedMessages.delete(id));
}, 1000 * 60 * 60); // Every hour

async function getHistory(auth, startHistoryId) {
  try {
    return await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'], // Remove messageModified
      labelId: 'INBOX'
    });
  } catch (error) {
    logger.error('Error fetching history:', error);
    throw error;
  }
}

// ... (rest of the file remains as shown in the file modifications)