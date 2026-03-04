/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, useWatch } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { RHFSelectField } from "@/components/rhf/rhf-select-field";
import { Form } from "@/components/ui/form";

vi.mock("@/components/ui/select", async () => await import("@/test-utils/mocks/shadcn-select"));

type TestFormValues = {
  providerType: "oidc" | "oauth2";
};

function TestHarness({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const form = useForm<TestFormValues>({ defaultValues: { providerType: "oidc" } });
  const selected = useWatch({ control: form.control, name: "providerType" }) ?? "";

  return (
    <Form {...form}>
      <form>
        <RHFSelectField
          control={form.control}
          name="providerType"
          label="Provider type"
          placeholder="Select provider type"
          options={[
            { value: "oidc", label: "OpenID Connect" },
            { value: "oauth2", label: "OAuth 2.0" },
          ]}
          onValueChange={onValueChange}
        />
        <span data-testid="provider-value">{selected}</span>
      </form>
    </Form>
  );
}

describe("RHFSelectField", () => {
  it("reads defaults from RHF and updates on selection", async () => {
    const user = userEvent.setup();
    const handleValueChange = vi.fn();

    render(<TestHarness onValueChange={handleValueChange} />);

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("oidc");
    expect(screen.getByTestId("provider-value")).toHaveTextContent("oidc");

    await user.selectOptions(select, "oauth2");

    expect(select).toHaveValue("oauth2");
    expect(screen.getByTestId("provider-value")).toHaveTextContent("oauth2");
    expect(handleValueChange).toHaveBeenCalledWith("oauth2");
  });
});
