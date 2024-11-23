// Previous content remains the same until getGmailAuth function

async function getGmailAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    // Verify the credentials work and permissions are correct
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      
      // Test Gmail API permissions
      await gmail.users.labels.list({ userId: 'me' });
      
      lastHistoryId = profile.data.historyId;
      logger.info('Gmail credentials and permissions verified successfully', { 
        historyId: lastHistoryId,
        email: profile.data.emailAddress 
      });
    } catch (error) {
      logger.error('Gmail authentication failed:', {
        error: error.message,
        response: error.response?.data,
        code: error.code,
        status: error.response?.status
      });
      throw new Error(`Gmail authentication failed: ${error.message}`);
    }

    auth = oauth2Client;
  }
  return auth;
}

async function processNewMessages(startHistoryId) {
  const auth = await getGmailAuth();
  
  try {
    logger.info('Fetching message history', { 
      startHistoryId,
      lastKnownHistoryId: lastHistoryId 
    });

    // Verify historyId is valid
    if (!startHistoryId || isNaN(parseInt(startHistoryId))) {
      logger.error('Invalid historyId received', { startHistoryId });
      return 0;
    }

    // Test history list access first
    try {
      await gmail.users.history.list({
        auth,
        userId: 'me',
        startHistoryId: startHistoryId,
        maxResults: 1
      });
    } catch (error) {
      if (error.response?.status === 404) {
        logger.error('History ID not found or too old', { 
          startHistoryId,
          error: error.message 
        });
        // Get the latest history ID
        const profile = await gmail.users.getProfile({ 
          auth,
          userId: 'me' 
        });
        lastHistoryId = profile.data.historyId;
        return 0;
      }
      throw error;
    }

    // Rest of the processNewMessages function remains the same...