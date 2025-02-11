import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';
import { SCOPES } from './config.js';

export async function getSheetAuth() {
  try {
    const secrets = await getSecrets();
    const spreadsheetId = secrets.SHEETS_ID_MICHELLE_CHAT_LOG;

    if (!spreadsheetId) {
      throw new Error('SHEETS_ID_MICHELLE_CHAT_LOG not found in secrets');
    }

    const auth = await google.auth.getClient({
      scopes: SCOPES
    });

    return { auth, spreadsheetId };
  } catch (error) {
    logger.error('Error getting sheet auth:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}