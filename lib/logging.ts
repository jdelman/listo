import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogFields = Record<string, string | number | boolean | string[] | undefined>;
export type Logger = (event: string, description: string, fields?: LogFields, level?: "info" | "error") => void;

// stderr keeps stdout available for the MCP stdio protocol.
export function createLogger(channel: "application" | "worker", directory?: string): Logger {
  return (event, description, fields = {}, level = "info") => {
    const line = JSON.stringify({ ...fields, timestamp: new Date().toISOString(), level, channel, pid: process.pid, event, description });
    console.error(line);
    try {
      const path = directory ?? process.env.LISTO_LOG_DIR ?? join(process.cwd(), "data", "logs");
      mkdirSync(path, { recursive: true });
      appendFileSync(join(path, `${channel}.log`), `${line}\n`, { mode: 0o600 });
    } catch (error) {
      // Logging failures must not turn a successful mutation into a failed request.
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "logging.write_failed", channel, description: "Could not write log file", error: safeError(error) }));
    }
  };
}

export function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) message = message.split(value).join("[redacted]");
  }
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 2000);
}

export const applicationLog = createLogger("application");
export const workerLog = createLogger("worker");
