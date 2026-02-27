// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { UpdateClientSigningAlgorithmsForm } from "@/app/admin/clients/[clientId]/client-forms";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/select", async () => await import("@/test-utils/mocks/shadcn-select"));

describe("Signing algorithm selects", () => {
  it("updates displayed state when selecting values", () => {
    render(
      <UpdateClientSigningAlgorithmsForm
        clientId="c1"
        initialIdTokenAlg={null}
        initialAccessTokenAlg={null}
        canEdit
      />,
    );

    const [idSelect, accessSelect] = screen.getAllByRole("combobox");

    fireEvent.change(idSelect as HTMLSelectElement, { target: { value: "RS256" } });
    expect(screen.getByText(/ID tokens will use/i).textContent).toMatch(/RS256/);

    fireEvent.change(accessSelect as HTMLSelectElement, { target: { value: "PS256" } });
    expect(screen.getByText(/Access tokens will use/i).textContent).toMatch(/PS256/);

    fireEvent.change(accessSelect as HTMLSelectElement, { target: { value: "match_id" } });
    expect(screen.getByText(/Access tokens will use/i).textContent).toMatch(/RS256/);
  });
});
