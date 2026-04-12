/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { UpdateClientRefreshTokenTtlForm } from "../[clientId]/client-forms";

const mockUpdateClientRefreshTokenTtlAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

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
  updateClientRefreshTokenTtlAction: mockUpdateClientRefreshTokenTtlAction,
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("UpdateClientRefreshTokenTtlForm", () => {
  beforeEach(() => {
    mockUpdateClientRefreshTokenTtlAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("submits the entered TTL value", async () => {
    const user = userEvent.setup();
    render(<UpdateClientRefreshTokenTtlForm clientId="client_1" canEdit initialTtl={86400} />);

    const input = screen.getByTestId("refresh-token-ttl-input");
    await user.clear(input);
    await user.type(input, "7200");
    await user.click(screen.getByTestId("refresh-token-ttl-save"));

    await waitFor(() => {
      expect(mockUpdateClientRefreshTokenTtlAction).toHaveBeenCalledWith({
        clientId: "client_1",
        refreshTokenTtlSeconds: 7200,
      });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("shows validation errors for below-min values", async () => {
    const user = userEvent.setup();
    render(<UpdateClientRefreshTokenTtlForm clientId="client_2" canEdit initialTtl={86400} />);

    const input = screen.getByTestId("refresh-token-ttl-input");
    await user.clear(input);
    await user.type(input, "30");
    await user.click(screen.getByTestId("refresh-token-ttl-save"));

    expect(await screen.findByText("Enter at least 60 seconds")).toBeVisible();
    expect(mockUpdateClientRefreshTokenTtlAction).not.toHaveBeenCalled();
  });

  it("shows validation errors for above-max values", async () => {
    const user = userEvent.setup();
    render(<UpdateClientRefreshTokenTtlForm clientId="client_3" canEdit initialTtl={86400} />);

    const input = screen.getByTestId("refresh-token-ttl-input");
    await user.clear(input);
    await user.type(input, "2592001");
    await user.click(screen.getByTestId("refresh-token-ttl-save"));

    expect(await screen.findByText("Limit to 2,592,000 seconds (30 days)")).toBeVisible();
    expect(mockUpdateClientRefreshTokenTtlAction).not.toHaveBeenCalled();
  });

  it("renders a read-only state when editing is disabled", () => {
    render(<UpdateClientRefreshTokenTtlForm clientId="client_4" canEdit={false} initialTtl={7200} />);

    expect(screen.getByTestId("refresh-token-ttl-input")).toBeDisabled();
    expect(screen.getByText("Read-only")).toBeDisabled();
  });
});
