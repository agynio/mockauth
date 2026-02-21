/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { UpdateClientIssuerForm } from "../[clientId]/client-forms";

const mockUpdateClientIssuerAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: vi.fn(),
  updateClientIssuerAction: mockUpdateClientIssuerAction,
  updateClientNameAction: vi.fn(),
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

const defaultResources = [
  { id: "api_res_1", label: "Primary API" },
  { id: "api_res_2", label: "Payments API" },
];

const renderForm = (props?: Partial<Parameters<typeof UpdateClientIssuerForm>[0]>) => {
  return render(
    <UpdateClientIssuerForm
      clientId="client_123"
      canEdit
      defaultResourceId="api_res_1"
      defaultResourceName="Primary API"
      currentResourceId={props?.currentResourceId ?? "api_res_2"}
      usesDefault={props?.usesDefault ?? false}
      resources={props?.resources ?? defaultResources}
      {...props}
    />,
  );
};

describe("UpdateClientIssuerForm", () => {
  beforeEach(() => {
    mockUpdateClientIssuerAction.mockClear();
    mockRefresh.mockClear();
    mockToast.mockClear();
  });

  it("loads the tenant default when usesDefault is true", () => {
    renderForm({ usesDefault: true });
    expect(screen.getByLabelText("API resource")).toHaveValue("default");
  });

  it("syncs the selection when props change", async () => {
    const { rerender } = renderForm({ currentResourceId: "api_res_2", usesDefault: false });
    const select = screen.getByLabelText("API resource");
    expect(select).toHaveValue("api_res_2");

    rerender(
      <UpdateClientIssuerForm
        clientId="client_123"
        canEdit
        defaultResourceId="api_res_1"
        defaultResourceName="Primary API"
        currentResourceId="api_res_1"
        usesDefault
        resources={defaultResources}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("API resource")).toHaveValue("default");
    });
  });

  it("submits the selected API resource", async () => {
    const user = userEvent.setup();
    renderForm();

    const select = screen.getByLabelText("API resource");
    await user.selectOptions(select, "api_res_1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateClientIssuerAction).toHaveBeenCalledWith({ clientId: "client_123", apiResourceId: "api_res_1" });
    });
  });

  it("sends tenant default when the default option is chosen", async () => {
    const user = userEvent.setup();
    renderForm({ usesDefault: false });

    const select = screen.getByLabelText("API resource");
    await user.selectOptions(select, "default");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateClientIssuerAction).toHaveBeenCalledWith({ clientId: "client_123", apiResourceId: "default" });
    });
  });
});
