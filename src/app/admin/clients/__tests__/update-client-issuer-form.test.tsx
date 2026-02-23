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
  updateClientReauthTtlAction: vi.fn(),
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
  const currentResourceProp = props && Object.prototype.hasOwnProperty.call(props, "currentResourceId") ? props.currentResourceId : undefined;
  return render(
    <UpdateClientIssuerForm
      clientId="client_123"
      canEdit
      defaultResourceId="api_res_1"
      defaultResourceName="Primary API"
      currentResourceId={currentResourceProp ?? "api_res_2"}
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

  it("maps null resource ids to the tenant default label", () => {
    renderForm({ currentResourceId: null, usesDefault: true });
    expect(screen.getByLabelText("API resource")).toHaveDisplayValue("Tenant default (Primary API)");
  });

  it("left-aligns the collapsed trigger label", () => {
    renderForm();
    const trigger = screen.getByTestId("client-issuer-trigger");
    expect(trigger).toHaveClass("text-left");
  });

  it("updates the trigger text when a resource is selected", async () => {
    const user = userEvent.setup();
    renderForm();

    const select = screen.getByLabelText("API resource");
    await user.selectOptions(select, "api_res_1");

    await waitFor(() => {
      expect(screen.getByLabelText("API resource")).toHaveDisplayValue("Primary API");
    });
  });

  it("persists the chosen resource across rerenders until props change", async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();
    const select = screen.getByLabelText("API resource");
    await user.selectOptions(select, "api_res_1");

    rerender(
      <UpdateClientIssuerForm
        clientId="client_123"
        canEdit
        defaultResourceId="api_res_1"
        defaultResourceName="Primary API"
        currentResourceId="api_res_2"
        usesDefault={false}
        resources={defaultResources}
      />,
    );

    expect(screen.getByLabelText("API resource")).toHaveDisplayValue("Primary API");

    rerender(
      <UpdateClientIssuerForm
        clientId="client_123"
        canEdit
        defaultResourceId="api_res_1"
        defaultResourceName="Primary API"
        currentResourceId={null}
        usesDefault
        resources={defaultResources}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("API resource")).toHaveDisplayValue("Tenant default (Primary API)");
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
