import { expect, test } from "@playwright/test";

const repoUrl = "https://github.com/agynio/mockauth";

test("landing primary CTA is present with placeholder target", async ({ page }) => {
  await page.goto("/");

  const signInCta = page.getByTestId("landing-sign-in-link");
  await expect(signInCta).toHaveAttribute("type", "button");
  await expect(signInCta).toHaveText("Get Started");

  const getStartedCtas = page.getByRole("link", { name: "Get Started" });
  await expect(getStartedCtas).toHaveCount(1);
  await expect(getStartedCtas.first()).toHaveAttribute("href", "#quick-start");

  const githubLinks = page.getByRole("link", { name: "View on GitHub" });
  await expect(githubLinks.first()).toHaveAttribute("href", repoUrl);

  const header = page.getByRole("banner");
  const brandLink = header.getByRole("link", { name: "MockAuth" });
  await expect(brandLink).toHaveAttribute("href", "/");
  await expect(header.getByRole("link", { name: "GitHub" })).toHaveCount(0);
});
