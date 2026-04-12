/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { UpdateAuthStrategiesForm } from "../[clientId]/client-forms";

const mockUpdateClientAuthStrategiesAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  addPostLogoutRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  deletePostLogoutRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: mockUpdateClientAuthStrategiesAction,
  updateClientIssuerAction: vi.fn(),
  updateClientNameAction: vi.fn(),
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

vi.mock("@/components/ui/select", () => import("@/test-utils/mocks/shadcn-select"));

const defaultStrategies: ClientAuthStrategies = {
  username: { enabled: true, subSource: "entered" },
  email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
};

const renderForm = (overrides?: Partial<ClientAuthStrategies>) => {
  const initialStrategies = overrides ? { ...defaultStrategies, ...overrides } : defaultStrategies;
  return render(
    <UpdateAuthStrategiesForm
      clientId="client_123"
      canEdit
      initialStrategies={initialStrategies}
    />,
  );
};

describe("UpdateClientAuthStrategiesForm", () => {
  beforeEach(() => {
    mockUpdateClientAuthStrategiesAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("shows the current subject source selection", () => {
    renderForm();
    const trigger = screen.getByTestId("strategy-username-subsource");
    expect(trigger).toHaveTextContent("Use entered value");
  });

  it("updates the displayed selection when initial strategies change", async () => {
    const { rerender } = renderForm();
    const trigger = screen.getByTestId("strategy-username-subsource");
    expect(trigger).toHaveTextContent("Use entered value");

    rerender(
      <UpdateAuthStrategiesForm
        key="updated"
        clientId="client_123"
        canEdit
        initialStrategies={{
          username: { enabled: true, subSource: "generated_uuid" },
          email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("strategy-username-subsource")).toHaveTextContent("Generate UUID (stable per identity)");
    });
  });

  it("renders the stable identity option", () => {
    renderForm();
    const options = screen.getAllByRole("option", { name: "Generate UUID (stable per identity)" });
    expect(options).not.toHaveLength(0);
  });

  it("submits the selected subject source", async () => {
    const user = userEvent.setup();
    renderForm();

    const trigger = screen.getByTestId("strategy-username-subsource");
    await user.selectOptions(trigger, "generated_uuid");
    await user.click(screen.getByRole("button", { name: /Save strategies/i }));

    await waitFor(() => {
      expect(mockUpdateClientAuthStrategiesAction).toHaveBeenCalledWith({
        clientId: "client_123",
        username: { enabled: true, subSource: "generated_uuid" },
        email: { enabled: false, subSource: "entered", emailVerifiedMode: "false" },
      });
    });
  });

  it("persists email verified mode selections", async () => {
    const user = userEvent.setup();
    renderForm({
      email: { enabled: true, subSource: "entered", emailVerifiedMode: "false" },
    });

    const trigger = screen.getByTestId("strategy-email-verified-mode");
    await user.selectOptions(trigger, "user_choice");
    await user.click(screen.getByRole("button", { name: /Save strategies/i }));

    await waitFor(() => {
      expect(mockUpdateClientAuthStrategiesAction).toHaveBeenCalledWith({
        clientId: "client_123",
        username: { enabled: true, subSource: "entered" },
        email: { enabled: true, subSource: "entered", emailVerifiedMode: "user_choice" },
      });
    });
  });
});
