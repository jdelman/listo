import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Accounts } from "../lib/auth/accounts";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { E2E_HOSTS, E2E_PASSWORD, E2E_PORT, usernameFor } from "./settings";

// Never connect browser tests to a running personal instance or its database.
const directory = mkdtempSync(join(tmpdir(), "listo-browser-"));
const database = join(directory, "test.sqlite");
const appDirectory = join(directory, "app");
mkdirSync(appDirectory);
for (const name of ["app", "lib", "mcp", "public", "next.config.ts", "tsconfig.json", "next-env.d.ts", "package.json"]) {
  if (existsSync(name)) cpSync(name, join(appDirectory, name), { recursive: true });
}
symlinkSync(resolve("node_modules"), join(appDirectory, "node_modules"), "dir");
const accounts = new Accounts(openListoDatabase(database));
for (const host of E2E_HOSTS) await accounts.create(usernameFor(host), E2E_PASSWORD);
accounts.db.close();
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "0.0.0.0", "--port", String(E2E_PORT)], {
  cwd: appDirectory,
  stdio: "inherit",
  env: { ...process.env, LISTO_DB_PATH: database, LISTO_ORIGIN: `http://localhost:${E2E_PORT}`, LISTO_LOG_DIR: join(directory, "logs"), LISTO_THUMBNAIL_DIR: join(directory, "thumbnails") },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill("SIGTERM"));
child.once("exit", code => { rmSync(directory, { recursive: true, force: true }); process.exitCode = code || 0; });
