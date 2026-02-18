import { expect, test } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

test.describe("collaboration", () => {
  test("invites can be accepted and revoked", async ({ page, browser }) => {
    await stubClipboard(page);
    const ownerSession = await createTestSession(page, { role: "OWNER" });
    await authenticate(page, ownerSession);

    await page.goto("/admin/members");
    await expect(page.getByRole("heading", { name: "Collaboration" })).toBeVisible();

    // Create invite and capture link from dialog
    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("combobox", { name: "Invite role" }).click();
    await page.getByRole("option", { name: "Writer" }).click();
    await page.getByRole("combobox", { name: "Invite expiration" }).click();
    await page.getByRole("option", { name: "24 hours" }).click();
    await page.getByRole("button", { name: "Create invite" }).click();
    const inviteLink = await page.getByTestId("invite-link").inputValue();
    await page.getByTestId("invite-copy-inline").click();
    await expect(page.locator('[data-testid="invite-copy-inline"]')).toContainText("Copy");
    await page.getByRole("button", { name: "Done" }).click();

    // Invite should appear in list as active
    const firstInviteRow = page.getByTestId("invite-row").first();
    await expect(firstInviteRow.getByText("Active")).toBeVisible();

    // Accept invite as a different user (without prior membership)
    const inviteContext = await browser.newContext();
    const invitePage = await inviteContext.newPage();
    const inviteSession = await createTestSession(invitePage, {
      email: `collab-writer-${Date.now()}@example.test`,
      assignMembership: false,
    });
    await authenticate(invitePage, inviteSession);
    await invitePage.goto(inviteLink);
    await expect(invitePage.getByText("You're in")).toBeVisible();
    await inviteContext.close();

    await page.reload();
    await expect(page.getByTestId("member-row").filter({ hasText: /collab-writer/ })).toBeVisible();

    // Create a second invite, revoke it, and ensure the link stops working
    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("button", { name: "Create invite" }).click();
    const revokedLink = await page.getByTestId("invite-link").inputValue();
    await page.getByRole("button", { name: "Done" }).click();

    const latestInviteRow = page.getByTestId("invite-row").first();
    await latestInviteRow.getByRole("button", { name: "Copy link" }).click();
    const copiedLink = await page.evaluate(() => (window as typeof window & { __mockClipboard?: string }).__mockClipboard);
    expect(copiedLink).toContain("/admin/invite/");
    await latestInviteRow.getByRole("button", { name: "Revoke" }).click();
    await expect(latestInviteRow.getByText("Revoked")).toBeVisible();

    const revokedContext = await browser.newContext();
    const revokedPage = await revokedContext.newPage();
    const revokedSession = await createTestSession(revokedPage, {
      email: `collab-revoked-${Date.now()}@example.test`,
      assignMembership: false,
    });
    await authenticate(revokedPage, revokedSession);
    await revokedPage.goto(revokedLink);
    await expect(revokedPage.getByText("Unable to accept invite")).toBeVisible();
    await revokedContext.close();
  });
});
