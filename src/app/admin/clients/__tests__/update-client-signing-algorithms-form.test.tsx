/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { UpdateClientSigningAlgorithmsForm } from "../[clientId]/client-forms";

const mockUpdateClientSigningAlgsAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  addPostLogoutRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  deletePostLogoutRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: vi.fn(),
  updateClientScopesAction: vi.fn(),
  updateClientIssuerAction: vi.fn(),
  updateClientNameAction: vi.fn(),
  updateClientReauthTtlAction: vi.fn(),
  updateClientSigningAlgsAction: mockUpdateClientSigningAlgsAction,
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("UpdateClientSigningAlgorithmsForm", () => {
  beforeEach(() => {
    mockUpdateClientSigningAlgsAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("renders select options with pointer cursors", async () => {
    const user = userEvent.setup();

    render(
      <UpdateClientSigningAlgorithmsForm
        clientId="client_123"
        canEdit
        initialIdTokenAlg="RS256"
        initialAccessTokenAlg="RS256"
      />,
    );

    const [idTrigger, accessTrigger] = screen.getAllByRole("combobox");

    await user.click(idTrigger);
    const psOption = await screen.findByRole("option", { name: "PS256 (RSA-PSS SHA-256)" });
    expect(psOption.className).toContain("cursor-pointer");

    await user.keyboard("{Escape}");

    await user.click(accessTrigger);
    const esOption = await screen.findByRole("option", { name: "ES384 (ECDSA P-384)" });
    expect(esOption.className).toContain("cursor-pointer");
  });
});
