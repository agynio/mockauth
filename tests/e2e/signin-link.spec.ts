import { expect, test } from "@playwright/test";

const repoUrl = "https://github.com/agynio/mockauth";
const directSignInUrl = "/api/auth/signin/logto?callbackUrl=/admin";

test("landing primary CTA is present with placeholder target", async ({ page }) => {
  await page.goto("/");

  const getStartedCtas = page.getByRole("link", { name: "Get Started" });
  await expect(getStartedCtas).toHaveCount(2);
  await expect(getStartedCtas.first()).toHaveAttribute("href", "#quick-start");
  await expect(getStartedCtas.last()).toHaveAttribute("href", "#quick-start");

  const githubLinks = page.getByRole("link", { name: "View on GitHub" });
  await expect(githubLinks.first()).toHaveAttribute("href", repoUrl);

  const headerGithub = page
    .getByRole("banner")
    .getByRole("link", { name: "GitHub" });
  await expect(headerGithub).toHaveAttribute("href", repoUrl);

  await expect(page.getByRole("link", { name: "MockAuth" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("direct admin sign-in route lands on console", async ({ page, context, request }) => {
  await context.clearCookies();
  await request.delete("/api/test/logto/profile");
  await request.post("/api/test/logto/profile", {
    data: { email: "owner@example.test", sub: "landing-direct" },
  });

  await page.goto(directSignInUrl);
  await expect(page.getByRole("button", { name: /logto/i })).toBeVisible();
  await page.getByRole("button", { name: /logto/i }).click();
  await page.waitForURL(/\/admin(\/clients)?$/);
  await expect(page.getByRole("heading", { name: "Admin overview" })).toBeVisible();
});
