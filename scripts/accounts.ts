import nextEnv from "@next/env";
import { Accounts } from "../lib/auth/accounts";
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const accounts = new Accounts();
const [action, username] = process.argv.slice(2);
if (action === "reset" && username) {
  const base = process.env.LISTO_ORIGIN || "http://localhost:3000";
  console.log(`${base}/reset-password?token=${accounts.resetLink(username)}`);
} else if (action === "create" && username && process.env.LISTO_ACCOUNT_PASSWORD) {
  const user = await accounts.create(username, process.env.LISTO_ACCOUNT_PASSWORD);
  console.log(`Created ${user.username}`);
} else if (action === "bootstrap" && process.env.LISTO_BOOTSTRAP_PASSWORD) {
  console.log(await accounts.bootstrap(process.env.LISTO_BOOTSTRAP_PASSWORD) ? "Initial account ready" : "Initial account already configured; password unchanged");
} else {
  console.error("Use accounts bootstrap with LISTO_BOOTSTRAP_PASSWORD; accounts create USER with LISTO_ACCOUNT_PASSWORD; or accounts reset USER.");
  process.exitCode = 1;
}
accounts.db.close();
