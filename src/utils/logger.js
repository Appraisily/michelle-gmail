import winston from 'winston';

// Format that matches Cloud Logging's expected structure
const cloudLogFormat = winston.format.printf(({ level, message, ...metadata }) => {
  // Severity levels that match Cloud Logging
  const severityMap = {
    error: 'ERROR',
    warn: 'WARNING',
    info: 'INFO',
    debug: 'DEBUG'
  };

  // Create the log entry
  const entry = {
    severity: severityMap[level] || 'DEFAULT',
    message: message,
    ...metadata
  };

  // Return as JSON string for Cloud Logging
  return JSON.stringify(entry);
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    cloudLogFormat
  ),
  transports: [
    new winston.transports.Console({
      // Console transport writes to stdout/stderr which Cloud Run captures
      handleExceptions: true,
      handleRejections: true
    })
  ],
  // Ensure all logs are captured
  exitOnError: false
});

// Add error handling
logger.exceptions.handle(
  new winston.transports.Console()
);