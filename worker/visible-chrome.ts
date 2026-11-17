import { visibleChromeDomain, visibleChromeDomains, type ReadVisiblePage } from "../lib/processing/visible-chrome";

export const readVisiblePage: ReadVisiblePage = async (url, domain, workerSignal) => {
  const signal = AbortSignal.any([workerSignal, AbortSignal.timeout(60_000)]);
  signal.throwIfAborted();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: false, chromiumSandbox: true, timeout: 10_000 });
  const close = () => browser.close().catch(() => {});
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });

  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "commit", timeout: 15_000 });
    // eBay can return a browser check before redirecting to the actual listing.
    await page.locator(visibleChromeDomains[domain]).waitFor({ state: "visible", timeout: 45_000 });
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
};
