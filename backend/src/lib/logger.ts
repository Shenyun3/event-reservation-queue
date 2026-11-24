/**
 * 结构化 JSON 日志输出工具（脱敏，统一写入 stdout / stderr 供 .logs/backend.log 收集）。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 结构化日志器接口。 */
export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, context?: Record<string, unknown>): void;
}

const SENSITIVE_KEY_PATTERN = /pass(word)?|token|secret|auth(orization)?|cookie|database_?url/i;

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeValue(val, seen);
  }
  return output;
}

function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined;
  return sanitizeValue(context, new WeakSet<object>()) as Record<string, unknown>;
}

/**
 * 创建基于标准输出的单行 JSON 日志器（自动脱敏敏感字段并容错循环引用）。
 *
 * @param minLevel 最低输出日志级别（默认 `info`）。
 * @returns 结构化日志器实例。
 */
export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_PRIORITY[minLevel];

  const emit = (level: LogLevel, msg: string, context?: Record<string, unknown>) => {
    if (LEVEL_PRIORITY[level] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...sanitizeContext(context),
    };
    let line: string;
    try {
      line = JSON.stringify(payload);
    } catch {
      line = JSON.stringify({
        ts: payload.ts,
        level,
        msg,
        serializationError: true,
      });
    }
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (msg, context) => emit('debug', msg, context),
    info: (msg, context) => emit('info', msg, context),
    warn: (msg, context) => emit('warn', msg, context),
    error: (msg, context) => emit('error', msg, context),
  };
}
