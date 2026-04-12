/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { UpdateClientScopesForm } from "../[clientId]/client-forms";

const mockUpdateClientScopesAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "Scopes saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  addPostLogoutRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  deletePostLogoutRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: vi.fn(),
  updateClientIssuerAction: vi.fn(),
  updateClientNameAction: vi.fn(),
  updateClientReauthTtlAction: vi.fn(),
  updateClientRefreshTokenTtlAction: vi.fn(),
  updateClientScopesAction: mockUpdateClientScopesAction,
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("UpdateClientScopesForm", () => {
  beforeEach(() => {
    mockUpdateClientScopesAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("submits selected scopes", async () => {
    const user = userEvent.setup();
    render(<UpdateClientScopesForm clientId="client_1" initialScopes={["openid"]} canEdit />);

    await user.click(screen.getByTestId("scope-suggestion-profile"));
    await user.click(screen.getByTestId("scope-save-button"));

    await waitFor(() => {
      expect(mockUpdateClientScopesAction).toHaveBeenCalledWith({ clientId: "client_1", scopes: ["openid", "profile"] });
      expect(mockRefresh).toHaveBeenCalled();
    });
    expect(mockToast).toHaveBeenCalledWith({ title: "Scopes updated", description: "Scopes saved" });
  });

  it("preserves mixed-case scope input", async () => {
    const user = userEvent.setup();
    render(<UpdateClientScopesForm clientId="client_1" initialScopes={["openid"]} canEdit />);

    await user.type(screen.getByTestId("scope-input"), "r_organizationSocialAnalytics");
    await user.keyboard("{Enter}");
    await user.click(screen.getByTestId("scope-save-button"));

    await waitFor(() => {
      expect(mockUpdateClientScopesAction).toHaveBeenCalledWith({
        clientId: "client_1",
        scopes: ["openid", "r_organizationSocialAnalytics"],
      });
    });
  });

  it("shows an error when the action fails", async () => {
    const user = userEvent.setup();
    mockUpdateClientScopesAction.mockResolvedValueOnce({ error: "Unsupported scope" });
    render(<UpdateClientScopesForm clientId="client_2" initialScopes={["openid", "email"]} canEdit />);

    await user.click(screen.getByTestId("scope-suggestion-profile"));
    await user.click(screen.getByTestId("scope-save-button"));

    await waitFor(() => {
      expect(mockUpdateClientScopesAction).toHaveBeenCalledWith({ clientId: "client_2", scopes: ["openid", "email", "profile"] });
    });
    expect(mockToast).toHaveBeenCalledWith({ variant: "destructive", title: "Unable to update", description: "Unsupported scope" });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders a read-only state when editing is disabled", () => {
    render(<UpdateClientScopesForm clientId="client_3" initialScopes={["openid", "profile", "email"]} canEdit={false} />);

    expect(screen.getByTestId("scope-input")).toBeDisabled();
    expect(screen.getByTestId("scope-save-button")).toBeDisabled();
    expect(screen.getByTestId("scope-save-button")).toHaveTextContent("Read-only");
    expect(screen.queryByTestId("remove-scope-profile")).not.toBeInTheDocument();
    expect(screen.getByTestId("scope-suggestion-address")).toBeDisabled();
  });
});
