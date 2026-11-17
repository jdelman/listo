import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, E2E_PORT, usernameFor } from "./settings";

async function signIn(page: Page, host: string) {
  await page.getByLabel("Username", { exact: true }).fill(usernameFor(host));
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("login preserves the chosen hostname, restores the requested page, and logs out", async ({ page, baseURL }, info) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Fprofile`);
  await signIn(page, info.project.name);
  await expect(page).toHaveURL(`${baseURL}/profile`);
  await expect(page.getByText(`Signed in as ${usernameFor(info.project.name)}`)).toBeVisible();
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === "listo_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.domain).toBe(info.project.name);
  // GET logout is not a state-changing action.
  expect((await page.goto("/logout"))?.status()).toBe(405);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/login`);
  expect((await page.context().cookies()).some(cookie => cookie.name === "listo_session")).toBe(false);
  await page.goto("/profile");
  await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Fprofile`);
});

test("incorrect credentials show a usable error without switching hosts", async ({ page, baseURL }, info) => {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(usernameFor(info.project.name));
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Username or password is incorrect.");
  expect(new URL(page.url()).origin).toBe(baseURL);
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(`${baseURL}/reset-password`);
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
});

test("authenticated list changes persist through reload on every hostname", async ({ page, baseURL }, info) => {
  await page.goto("/login");
  await signIn(page, info.project.name);
  await expect(page).toHaveURL(`${baseURL}/lists`);
  await page.getByRole("button", { name: "New list", exact: true }).click();
  const title = `Browser regression ${info.project.name}`;
  await page.getByLabel("Title", { exact: true }).fill(title);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/commands" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create list", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(baseURL);
});

test("a form posted from an unrelated site cannot log the browser in", async ({ page, baseURL }, info) => {
  await page.route("http://untrusted.test/**", route => route.fulfill({
    contentType: "text/html",
    body: `<form method="post" action="${baseURL}/api/auth/login"><input name="username" value="${usernameFor(info.project.name)}"><input name="password" value="${E2E_PASSWORD}"><button>Submit cross-site login</button></form>`,
  }));
  await page.goto("http://untrusted.test/");
  const rejected = page.waitForResponse(response => response.url() === `${baseURL}/api/auth/login`);
  await page.getByRole("button", { name: "Submit cross-site login" }).click();
  expect((await rejected).status()).toBe(403);
  expect((await page.context().cookies()).some(cookie => cookie.name === "listo_session")).toBe(false);
  await page.goto(`${baseURL}/profile`);
  await expect(page).toHaveURL(`${baseURL}/login?returnTo=%2Fprofile`);
});

test("OAuth consent sends a same-origin POST and returns the code to the local client", async ({ page, request, baseURL }, info) => {
  const callback = `http://127.0.0.1:${E2E_PORT}/test-oauth-callback`;
  const registration = await request.post("/oauth/register", {
    data: { client_name: "Local MCP client", redirect_uris: [callback] },
  });
  expect(registration.status()).toBe(201);
  const { client_id } = await registration.json();
  const params = new URLSearchParams({
    client_id,
    redirect_uri: callback,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update("test-verifier".repeat(4)).digest("base64url"),
    resource: `http://localhost:${E2E_PORT}/mcp`,
    state: "test-state",
  });

  await page.goto(`/oauth/authorize?${params}`);
  await signIn(page, info.project.name);
  await expect(page.getByRole("heading", { name: "Connect Local MCP client?" })).toBeVisible();

  const consent = page.waitForResponse(response => response.url() === `${baseURL}/oauth/consent`);
  await page.getByRole("button", { name: "Allow access" }).click();
  const response = await consent;
  expect((await response.request().allHeaders()).origin).toBe(baseURL);
  expect(response.status()).toBe(303);
  const result = new URL((await response.headerValue("location"))!);
  expect(result.origin + result.pathname).toBe(callback);
  expect(result.searchParams.get("state")).toBe("test-state");
  expect(result.searchParams.get("code")).toBeTruthy();
});

test("item description, Markdown, and Spotify links open in a separate tab", async ({ page, context }, info) => {
  const spotifyUrl = "https://open.spotify.com/album/46VoobaZCtFPReElOHFEqq";
  await page.goto("/login");
  await signIn(page, info.project.name);
  await expect(page.getByRole("heading", { name: "Lists", exact: true })).toBeVisible();

  const id = await page.evaluate(async ({ spotifyUrl }) => {
    const id = crypto.randomUUID();
    const response = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "createItem",
        listIds: ["inbox"],
        item: {
          id,
          type: "media",
          title: "JuJu",
          description: "Read the [album notes](https://example.com/notes).",
          tags: [],
          availability: { external: false, localReference: false, imported: false },
          metadata: { markdown: "- Source: https://example.com/source.", spotifyUrl },
        },
      }),
    });
    if (!response.ok) throw new Error("Test item could not be created");
    return id;
  }, { spotifyUrl });

  await page.goto(`/items/${id}`);
  const notes = page.getByRole("link", { name: "album notes" });
  await expect(notes).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "https://example.com/source", exact: true })).toHaveAttribute("target", "_blank");
  const spotify = page.getByRole("link", { name: "Open in Spotify" });
  await expect(spotify).toHaveAttribute("href", spotifyUrl);
  await expect(spotify).toHaveAttribute("target", "_blank");

  await context.route("https://example.com/notes", route => route.fulfill({ body: "Album notes" }));
  const opened = page.waitForEvent("popup");
  await notes.click();
  await expect(await opened).toHaveURL("https://example.com/notes");
  await expect(page).toHaveURL(new RegExp(`/items/${id}$`));
});
