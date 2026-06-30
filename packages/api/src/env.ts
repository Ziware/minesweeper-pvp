/**
 * Typed environment variables with validation at startup.
 * Throws if any required variable is missing.
 */

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  NODE_ENV:  optional('NODE_ENV', 'development'),
  PORT:      parseInt(optional('PORT', '3002'), 10),

  DATABASE_URL: required('DATABASE_URL'),

  JWT_SECRET:   required('JWT_SECRET'),
  /** JWT lifetime in seconds. Default: 30 days. */
  JWT_EXPIRES_IN: parseInt(optional('JWT_EXPIRES_IN', String(60 * 60 * 24 * 30)), 10),

  SMTP_HOST: required('SMTP_HOST'),
  SMTP_PORT: parseInt(optional('SMTP_PORT', '587'), 10),
  SMTP_USER: required('SMTP_USER'),
  SMTP_PASS: required('SMTP_PASS'),
  SMTP_FROM: optional('SMTP_FROM', 'Minesweeper PvP <noreply@example.com>'),

  /** Comma-separated list of allowed frontend origins. */
  CORS_ORIGINS: optional('CORS_ORIGINS', 'http://localhost:5173,http://localhost:80'),

  /** Shared secret for backend → api internal calls. */
  INTERNAL_API_KEY: required('INTERNAL_API_KEY'),

  /** Directory where uploaded avatars are stored. */
  UPLOADS_DIR: optional('UPLOADS_DIR', '/app/uploads'),

  /** Maximum avatar upload size in MB. */
  MAX_AVATAR_SIZE_MB: parseInt(optional('MAX_AVATAR_SIZE_MB', '2'), 10),
};
