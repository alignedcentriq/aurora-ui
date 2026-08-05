import { test, expect, type Page } from "@playwright/test";

// Reuses the existing localhost-only auth bypass (src/lib/auth-store.tsx) —
// no MSAL/SSO interaction needed for e2e.
const TEST_EMAIL = "e2e-test@alignedautomation.com";

async function gotoChat(page: Page) {
  await page.goto(`/?mock-email=${encodeURIComponent(TEST_EMAIL)}`);
  await expect(page.locator("textarea")).toBeVisible({ timeout: 30_000 });
}

async function ask(page: Page, question: string) {
  const textarea = page.locator("textarea");
  await textarea.fill(question);
  await textarea.press("Enter");
}

test.describe("core chat flow", () => {
  test("loads the chat home for a logged-in user", async ({ page }) => {
    await gotoChat(page);
    await expect(page.locator("textarea")).toBeEnabled();
  });

  test("asking a question produces an assistant response", async ({ page }) => {
    await gotoChat(page);
    await ask(page, "Hello, what can you help me with?");

    await expect(page.locator(".chat-bubble-user")).toBeVisible();
    await expect(page.locator(".chat-bubble-assistant").last()).toBeVisible({
      timeout: 60_000,
    });

    // Streaming cursor disappears once the response finishes (never asserts
    // exact wording — the model's output is non-deterministic).
    await expect(
      page.locator(".chat-bubble-assistant .animate-pulse").last(),
    ).toBeHidden({ timeout: 60_000 });
  });

  test("a policy question surfaces citations", async ({ page }) => {
    await gotoChat(page);
    await ask(page, "What is the company leave policy?");

    await expect(page.getByText(/Grounded in \d+ source/)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("a backend failure shows a graceful error instead of hanging", async ({
    page,
  }) => {
    await gotoChat(page);
    await page.route("**/api/chat", (route) => route.abort("failed"));

    await ask(page, "This request should fail");

    await expect(
      page.getByText(/unavailable|something went wrong|server is busy/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
