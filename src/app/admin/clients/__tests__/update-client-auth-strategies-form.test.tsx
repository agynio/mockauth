/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { ClientAuthStrategies } from "@/server/oidc/auth-strategy";
import { UpdateAuthStrategiesForm } from "../[clientId]/client-forms";

const mockUpdateClientAuthStrategiesAction = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "saved" }));

vi.mock("@/app/admin/actions", () => ({
  addRedirectUriAction: vi.fn(),
  deleteRedirectUriAction: vi.fn(),
  rotateClientSecretAction: vi.fn(),
  updateClientAuthStrategiesAction: mockUpdateClientAuthStrategiesAction,
  updateClientIssuerAction: vi.fn(),
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

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Option = { value: string; label: string };
  const SelectContext = React.createContext<{
    value: string;
    onValueChange: (next: string) => void;
    registerOption: (option: Option) => void;
    options: Option[];
    disabled: boolean;
  } | null>(null);

  const Select = ({ value, defaultValue, onValueChange, disabled = false, children }: any) => {
    const [options, setOptions] = React.useState<Option[]>([]);
    const [currentValue, setCurrentValue] = React.useState<string>(value ?? defaultValue ?? "");
    React.useEffect(() => {
      if (value !== undefined) {
        setCurrentValue(value);
      }
    }, [value]);
    const registerOption = (option: Option) => {
      setOptions((prev) => {
        const existing = prev.find((item) => item.value === option.value);
        if (existing && existing.label === option.label) {
          return prev;
        }
        const next = prev.filter((item) => item.value !== option.value);
        return [...next, option];
      });
    };
    const handleChange = (next: string) => {
      setCurrentValue(next);
      onValueChange?.(next);
    };
    return (
      <SelectContext.Provider value={{ value: currentValue, onValueChange: handleChange, registerOption, options, disabled }}>
        {children}
      </SelectContext.Provider>
    );
  };

  const SelectTrigger = ({ "data-testid": dataTestId, "aria-label": ariaLabel }: any) => {
    const context = React.useContext(SelectContext);
    if (!context) return null;
    return (
      <select
        data-testid={dataTestId}
        aria-label={ariaLabel}
        value={context.value ?? ""}
        onChange={(event) => context.onValueChange(event.target.value)}
        disabled={context.disabled}
      >
        {context.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  };

  const SelectContent = ({ children }: any) => <>{children}</>;

  const SelectItem = ({ value, children }: any) => {
    const context = React.useContext(SelectContext);
    React.useEffect(() => {
      context?.registerOption({ value, label: String(children) });
    }, [context, value, children]);
    return null;
  };

  const SelectValue = ({ children }: any) => <>{children}</>;
  const SelectGroup = ({ children }: any) => <>{children}</>;
  const SelectLabel = ({ children }: any) => <>{children}</>;
  const SelectSeparator = () => null;

  return {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
  };
});

const defaultStrategies: ClientAuthStrategies = {
  username: { enabled: true, subSource: "entered" },
  email: { enabled: false, subSource: "entered" },
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
          email: { enabled: false, subSource: "entered" },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("strategy-username-subsource")).toHaveTextContent("Generate UUID per session");
    });
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
        email: { enabled: false, subSource: "entered" },
      });
    });
  });
});
