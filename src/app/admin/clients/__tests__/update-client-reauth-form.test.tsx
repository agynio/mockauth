/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { UpdateClientReauthTtlForm } from "../[clientId]/client-forms";

const mockUpdateClientReauthTtlAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  addPostLogoutRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  deletePostLogoutRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: vi.fn(),
  updateClientIssuerAction: vi.fn(),
  updateClientNameAction: vi.fn(),
  updateClientReauthTtlAction: mockUpdateClientReauthTtlAction,
  updateClientRefreshTokenTtlAction: vi.fn(),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("UpdateClientReauthTtlForm", () => {
  beforeEach(() => {
    mockUpdateClientReauthTtlAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("submits the entered TTL value", async () => {
    const user = userEvent.setup();
    render(<UpdateClientReauthTtlForm clientId="client_1" canEdit initialTtl={0} />);

    const input = screen.getByTestId("reauth-ttl-input");
    await user.clear(input);
    await user.type(input, "300");
    await user.click(screen.getByTestId("reauth-ttl-save"));

    await waitFor(() => {
      expect(mockUpdateClientReauthTtlAction).toHaveBeenCalledWith({ clientId: "client_1", reauthTtlSeconds: 300 });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("shows validation errors for out-of-range values", async () => {
    const user = userEvent.setup();
    render(<UpdateClientReauthTtlForm clientId="client_2" canEdit initialTtl={120} />);

    const input = screen.getByTestId("reauth-ttl-input");
    await user.clear(input);
    await user.type(input, "-5");
    await user.click(screen.getByTestId("reauth-ttl-save"));

    expect(await screen.findByText("Enter 0 or a positive number")).toBeVisible();
    expect(mockUpdateClientReauthTtlAction).not.toHaveBeenCalled();
  });

  it("renders a read-only state when editing is disabled", () => {
    render(<UpdateClientReauthTtlForm clientId="client_3" canEdit={false} initialTtl={45} />);

    expect(screen.getByTestId("reauth-ttl-input")).toBeDisabled();
    expect(screen.getByText("Read-only")).toBeDisabled();
  });
});
