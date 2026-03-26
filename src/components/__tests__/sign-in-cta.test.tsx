/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { SignInCta } from "@/components/sign-in-cta";

const mockSignIn = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  signIn: mockSignIn,
}));

describe("SignInCta", () => {
  beforeEach(() => {
    mockSignIn.mockClear();
  });

  it("renders the admin link when authenticated", () => {
    render(<SignInCta isAuthenticated>Sign in</SignInCta>);

    const cta = screen.getByTestId("landing-sign-in-link");
    expect(cta).toHaveAttribute("href", "/admin");
    expect(cta.tagName).toBe("A");
  });

  it("renders a button when unauthenticated", () => {
    render(<SignInCta isAuthenticated={false}>Sign in</SignInCta>);

    const cta = screen.getByTestId("landing-sign-in-link");
    expect(cta).toHaveAttribute("type", "button");
    expect(cta.tagName).toBe("BUTTON");
  });

  it("calls signIn on click when unauthenticated", async () => {
    const user = userEvent.setup();
    render(<SignInCta isAuthenticated={false}>Sign in</SignInCta>);

    await user.click(screen.getByTestId("landing-sign-in-link"));

    expect(mockSignIn).toHaveBeenCalledWith("logto", { callbackUrl: "/admin" });
  });
});
