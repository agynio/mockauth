import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { authenticate, createTestSession, stubClipboard } from "./helpers/admin";

const readClipboardText = async (page: Page, previousValue = "") => {
  await page.waitForFunction((prev) => {
    const current = (window as typeof window & { __mockClipboard?: string }).__mockClipboard ?? "";
    return Boolean(current) && current !== prev;
  }, previousValue);
  return page.evaluate(() => (window as typeof window & { __mockClipboard?: string }).__mockClipboard ?? "");
};

test.describe("collaboration", () => {
  test("invites can be accepted and revoked", async ({ page, browser }) => {
    await stubClipboard(page);
    const runId = Date.now();
    const ownerEmail = `collab-owner-${runId}@example.test`;
    const ownerSession = await createTestSession(page, { role: "OWNER", email: ownerEmail, name: "Collab Owner" });
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
    const inviteLink = await readClipboardText(page);

    // Invite should appear in list as active
    const firstInviteRow = page.getByTestId("invite-row").first();
    await expect(firstInviteRow.getByText("Active")).toBeVisible();

    // Accept invite as a different user (without prior membership)
    const invitedWriterEmail = `collab-writer-${Date.now()}@example.test`;
    const inviteContext = await browser.newContext();
    const invitePage = await inviteContext.newPage();
    const inviteSession = await createTestSession(invitePage, {
      email: invitedWriterEmail,
      assignMembership: false,
    });
    await authenticate(invitePage, inviteSession);
    await invitePage.goto(inviteLink);
    await expect(invitePage.getByText("You're in")).toBeVisible();
    await inviteContext.close();

    await page.reload();
    await expect(page.getByTestId("member-row").filter({ hasText: invitedWriterEmail })).toBeVisible();

    // Create a second invite, revoke it, and ensure the link stops working
    await page.getByRole("button", { name: "Invite member" }).click();
    await page.getByRole("button", { name: "Create invite" }).click();
    const revokedLink = await readClipboardText(page, inviteLink);

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

  test("enforces role-based permissions", async ({ page, browser }) => {
    await stubClipboard(page);

    // Owner can manage members
    const roleRunId = Date.now();
    const roleOwnerEmail = `collab-role-owner-${roleRunId}@example.test`;
    const ownerSession = await createTestSession(page, { role: "OWNER", email: roleOwnerEmail, name: "Role Owner" });
    await authenticate(page, ownerSession);
    await page.goto("/admin/members");
    await expect(page.getByRole("button", { name: "Invite member" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Member role" }).first()).toBeEnabled();
    await expect(page.getByTestId("member-remove").first()).toBeVisible();

    // Writer cannot manage members or invites
    const writerContext = await browser.newContext();
    const writerPage = await writerContext.newPage();
    const writerSession = await createTestSession(writerPage, {
      role: "WRITER",
      email: `collab-role-writer-${roleRunId}@example.test`,
      name: "Role Writer",
    });
    await authenticate(writerPage, writerSession);
    await writerPage.goto("/admin/members");
    await expect(writerPage.getByRole("button", { name: "Invite member" })).toHaveCount(0);
    await expect(writerPage.getByRole("combobox", { name: "Member role" })).toHaveCount(0);
    await expect(writerPage.getByTestId("member-remove")).toHaveCount(0);
    await expect(writerPage.getByText("Only owners can create or revoke invites.")).toBeVisible();
    await writerContext.close();

    // Reader cannot manage clients
    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    const readerSession = await createTestSession(readerPage, {
      role: "READER",
      email: `collab-role-reader-${roleRunId}@example.test`,
      name: "Role Reader",
    });
    await authenticate(readerPage, readerSession);
    await readerPage.goto("/admin/clients");
    const readOnlyButton = readerPage.getByRole("button", { name: "Read-only access" });
    await expect(readOnlyButton).toBeDisabled();

    const detailsLink = readerPage.getByRole("link", { name: /Details/ }).first();
    await detailsLink.click();
    await expect(readerPage.getByRole("button", { name: "Read-only" })).toBeDisabled();
    await expect(readerPage.getByRole("button", { name: "Add" })).toBeDisabled();
    await expect(readerPage.getByText("Client secrets can only be rotated by owners or writers.")).toBeVisible();
    await readerContext.close();
  });
});
