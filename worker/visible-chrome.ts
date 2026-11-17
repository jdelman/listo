import { resolve } from "node:path";
import { visibleChromeDomain, visibleChromeDomains, type ReadVisiblePage } from "../lib/processing/visible-chrome";

export const readVisiblePage: ReadVisiblePage = async (url, domain, workerSignal) => {
  const signal = AbortSignal.any([workerSignal, AbortSignal.timeout(60_000)]);
  const profile = resolve(process.env.LISTO_CHROME_PROFILE_DIR || "data/chrome-profile");
  const page = await readChromeSession(url, domain, profile, signal);
  if (page) return page;

  // Reopen the same profile once after eBay's generic 403 error. Cookies and
  // other site state written during the first session are available on retry.
  const retry = await readChromeSession(url, domain, profile, signal);
  if (retry) return retry;
  throw new Error("Chrome received eBay's error page (HTTP 403) twice");
};

async function readChromeSession(url: string, domain: string, profile: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { chromium, errors } = await import("playwright");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    chromiumSandbox: true,
    viewport: null,
    acceptDownloads: false,
    ignoreDefaultArgs: ["--enable-automation"],
    // Chrome's debugging pipe also exposes the automation indicator by default.
    args: ["--disable-blink-features=AutomationControlled"],
    timeout: 10_000,
  });
  const close = () => context.close().catch(() => {});
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });

  try {
    signal.throwIfAborted();
    const page = context.pages()[0] ?? await context.newPage();
    const response = await page.goto(url, { waitUntil: "commit", timeout: 15_000 });
    const listing = page.locator(visibleChromeDomains[domain]);
    // Give a browser check time to redirect before treating a 403 as terminal.
    if (domain === "ebay.com" && response?.status() === 403) {
      try {
        await listing.waitFor({ state: "visible", timeout: 5_000 });
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        if (await page.title() === "Error Page | eBay") return undefined;
      }
    }
    await listing.waitFor({ state: "visible", timeout: 45_000 });
    const finalUrl = page.url();
    if (visibleChromeDomain(new URL(finalUrl)) !== domain) throw new Error("Chrome left the requested site");
    const html = await page.content();
    signal.throwIfAborted();
    return { url: finalUrl, html };
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    await close();
  }
}
