import { type Logger, pino } from "pino";
import type { Role } from "./roles.js";

export type { Logger };

/**
 * JSON logs to stdout. Callers log ids, names and codes, never content or credentials; the
 * redaction below is the second fence, for objects that carry more than was meant to be logged.
 */
export function createLogger(options: { readonly level: string; readonly role: Role }): Logger {
  return pino({
    level: options.level,
    base: { role: options.role },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "authorization",
        "token",
        "*.authorization",
        "*.token",
        "*.headers.authorization",
        "*.headers.cookie",
        "*.connectionString",
        "*.url",
      ],
      censor: "[redacted]",
    },
  });
}
