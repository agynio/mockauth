import { expect, test } from "@playwright/test";

test("landing sign-in link stays on same host", async ({ page }) => {
  await page.goto("/");

  const signInLink = page.getByTestId("landing-sign-in-link");
  await expect(signInLink).toBeVisible();

  const linkHref = await signInLink.getAttribute("href");
  expect(linkHref).toBeTruthy();

  const currentHost = new URL(page.url()).host;
  const resolvedLink = new URL(linkHref ?? "", page.url());
  expect(resolvedLink.host).toBe(currentHost);

  await Promise.all([
    page.waitForURL("**/api/auth/signin/logto**"),
    signInLink.click(),
  ]);

  const navigatedHost = new URL(page.url()).host;
  expect(navigatedHost).toBe(currentHost);
});
