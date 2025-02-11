import { sheets, SHEET_NAMES } from '../config.js';
import { logger } from '../../../utils/logger.js';

export async function initializeGmailSheet(auth, spreadsheetId) {
  try {
    const response = await sheets.spreadsheets.get({
      auth,
      spreadsheetId
    });

    const gmailSheet = response.data.sheets.find(
      sheet => sheet.properties.title === SHEET_NAMES.GMAIL
    );

    if (!gmailSheet) {
      const headers = [
        ['Timestamp', 'Message ID', 'Sender', 'Subject', 'Has Images', 'Requires Reply', 
         'Classification', 'Reason', 'Intent', 'Urgency', 'Response Type', 'Generated Reply']
      ];

      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: SHEET_NAMES.GMAIL
              }
            }
          }]
        }
      });

      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: `${SHEET_NAMES.GMAIL}!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: { values: headers }
      });

      logger.info('Created Gmail sheet with headers');
    }
  } catch (error) {
    logger.error('Error initializing Gmail sheet:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}