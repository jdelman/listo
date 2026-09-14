import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, usernameFor } from "./settings";

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
