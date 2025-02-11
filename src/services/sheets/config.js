import { google } from 'googleapis';

export const sheets = google.sheets('v4');

export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000; // 1 second

export const SHEET_NAMES = {
  GMAIL: 'Gmail',
  CHAT: 'Chat'
};

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];