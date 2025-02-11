import { sheets } from './config.js';
import { logger } from '../../utils/logger.js';

export async function verifySheetExists(auth, spreadsheetId, sheetTitle) {
  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });

    const sheet = response.data.sheets.find(
      s => s.properties.title === sheetTitle
    );

    return !!sheet;
  } catch (error) {
    logger.error('Error verifying sheet existence:', {
      error: error.message,
      sheetTitle,
      stack: error.stack
    });
    return false;
  }
}

export async function appendToSheet(auth, spreadsheetId, range, values) {
  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });
    return true;
  } catch (error) {
    logger.error('Error appending to sheet:', {
      error: error.message,
      range,
      stack: error.stack
    });
    throw error;
  }
}