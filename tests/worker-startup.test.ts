import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const worker = resolve("worker/local-worker.ts");
const tsx = join(dirname(fileURLToPath(import.meta.resolve("tsx"))), "cli.mjs");

async function startup(withKey: boolean) {
  const directory = mkdtempSync(join(tmpdir(), "listo-worker-startup-"));
  // The child has an isolated, empty database and only a fake API key. No jobs can run.
  if (withKey) writeFileSync(join(directory, ".env.local"), "OPENROUTER_KEY=startup-test-only\n");
  const env: NodeJS.ProcessEnv = { ...process.env, LISTO_DB_PATH: join(directory, "test.sqlite"), LISTO_LOG_DIR: join(directory, "logs") };
  delete env.OPENROUTER_KEY;
  const child = spawn(process.execPath, [tsx, worker], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes('"event":"worker.ready"')) child.kill("SIGTERM");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.ok(output.includes("worker."), output);
    const log = readFileSync(join(directory, "logs", "worker.log"), "utf8");
    return { code, output, log };
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
}

test("worker CLI records a missing-key startup error", async () => {
  const result = await startup(false);
  assert.equal(result.code, 1);
  assert.match(result.log, /OPENROUTER_KEY is required/);
  assert.doesNotMatch(result.log, /Cannot read properties/);
});

test("worker CLI loads env config and reaches ready with an empty queue", async () => {
  const result = await startup(true);
  assert.equal(result.code, 0, result.output);
  assert.match(result.log, /worker.ready/);
  assert.match(result.log, /worker.stopped/);
  assert.doesNotMatch(result.log, /job.started/);
});
