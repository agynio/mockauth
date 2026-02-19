import { expect, test } from "@playwright/test";

const ownerEmail = "owner@example.test";
const signInUrl = "/api/auth/signin?callbackUrl=/admin/clients";

test.describe("nextauth admin linking", () => {
  test("links subsequent Logto subjects when flag enabled", async ({ page, context, request }) => {
    await context.clearCookies();
    await request.delete("/api/test/logto/profile");

    // First sign-in creates the initial provider account with sub A.
    await request.post("/api/test/logto/profile", { data: { email: ownerEmail, sub: "stub-initial" } });
    await page.goto(signInUrl);
    await expect(page.getByRole("button", { name: /logto/i })).toBeVisible();
    await page.getByRole("button", { name: /logto/i }).click();
    await expect(page).toHaveURL(/\/admin(\/clients)?/);
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();

    // Sign out to clear NextAuth session cookies.
    await page.goto("/api/auth/signout?callbackUrl=/");
    await context.clearCookies();

    // Second sign-in mimics a rotated Logto subject for the same email.
    await request.post("/api/test/logto/profile", { data: { email: ownerEmail, sub: "stub-rotated" } });
    await page.goto(signInUrl);
    await expect(page.getByRole("button", { name: /logto/i })).toBeVisible();
    await page.getByRole("button", { name: /logto/i }).click();

    await expect(page).toHaveURL(/\/admin(\/clients)?/);
    await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
  });
});
