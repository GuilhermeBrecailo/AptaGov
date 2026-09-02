import pino from 'pino';

const REDACTED = '[REDACTED]';
const EMAIL_FIELDS = new Set(['email', 'owneremail', 'notificationemail', 'recipient', 'to', 'from']);

export function redactLogData<T>(value: T, key?: string): T {
  if (key && isSensitiveKey(key)) return REDACTED as T;
  if (key && EMAIL_FIELDS.has(key.toLowerCase()) && typeof value === 'string') return redactEmail(value) as T;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    } as T;
  }
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactLogData(item)) as T;
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactLogData(entryValue, entryKey),
  ])) as T;
}

export function redactEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1) return REDACTED;
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      '**.token', '**.apiKey', '**.api_key', '**.secret', '**.password',
      '**.authorization', '**.headers.authorization', '**.cookie', '**.cookies', '**.set-cookie',
      '**.pushSubscription', '**.push_subscription', '**.vapidPrivateKey', '**.vapid_private_key',
      '**.raw', '**.rawPayload', '**.raw_payload', '**.payload', '**.databaseUrl', '**.DATABASE_URL',
    ],
    censor: REDACTED,
  },
  hooks: {
    logMethod(inputArgs, method) {
      if (inputArgs[0] && typeof inputArgs[0] === 'object') {
        inputArgs[0] = redactLogData(inputArgs[0]);
      }
      method.apply(this, inputArgs);
    },
  },
});

function isSensitiveKey(key: string): boolean {
  return /(?:api[_-]?key|authorization|cookie|password|secret|token|vapid.*private|push.*(?:subscription|key)|raw(?:_?payload)?|database[_-]?url)/i.test(key);
}

function redactString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => redactEmail(email))
    .replace(/(Bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\b(?:sk|pk|re)_[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:postgres(?:ql)?|mysql|file):[^\s,;]+/gi, REDACTED);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
