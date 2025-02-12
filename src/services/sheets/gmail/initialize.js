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
        [
          'A:Timestamp',
          'B:Message ID',
          'C:Thread ID',
          'D:Sender Email',
          'E:Sender Name',
          'F:Subject',
          'G:Message Content',
          'H:Has Images',
          'I:Image Count',
          'J:Classification Intent',
          'K:Classification Urgency',
          'L:Response Type',
          'M:Requires Reply',
          'N:Generated Reply',
          'O:Image Analysis',
          'P:Processing Time (ms)',
          'Q:Labels',
          'R:Status',
          'S:Error (if any)'
        ]
      ];

      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: SHEET_NAMES.GMAIL,
                gridProperties: {
                  frozenRowCount: 1
                }
              }
            }
          }]
        }
      });

      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: `${SHEET_NAMES.GMAIL}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: headers }
      });

      // Set column widths for better readability
      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId: gmailSheet.properties.sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 19
                },
                properties: {
                  pixelSize: 200
                },
                fields: 'pixelSize'
              }
            }
          ]
        }
      });

      logger.info('Created Gmail sheet with headers and formatting');
    }
  } catch (error) {
    logger.error('Error initializing Gmail sheet:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}