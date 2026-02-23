/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginForm } from "../login-form";

const baseProps = {
  apiResourceId: "resource_123",
  returnTo: "https://mockauth.test/r/resource_123/oidc/authorize?client_id=qa-client",
};

const multiStrategyConfig = [
  {
    key: "username" as const,
    title: "Username",
    description: "Enter any username",
    placeholder: "qa-user",
    subSource: "entered",
  },
  {
    key: "email" as const,
    title: "Email",
    description: "Enter any email",
    placeholder: "qa@example.test",
    subSource: "entered",
    emailVerifiedMode: "user_choice" as const,
  },
];

describe("LoginForm", () => {
  it("renders tabs and toggles the active strategy", async () => {
    const user = userEvent.setup();
    render(<LoginForm {...baseProps} strategies={multiStrategyConfig} />);

    const strategyInput = screen.getByTestId("login-strategy-input") as HTMLInputElement;
    expect(strategyInput.value).toBe("username");

    const usernameTab = screen.getByRole("tab", { name: "Username" });
    const emailTab = screen.getByRole("tab", { name: "Email" });
    await user.click(emailTab);
    expect(strategyInput.value).toBe("email");

    const emailField = screen.getByTestId("login-email-input") as HTMLInputElement;
    expect(emailField).toBeEnabled();
    expect(screen.queryByTestId("login-username-input")).not.toBeInTheDocument();

    const unverifiedOption = screen.getByLabelText("Unverified");
    await user.click(unverifiedOption);
    expect(unverifiedOption).toBeChecked();

    await user.click(usernameTab);
    expect(screen.getByTestId("login-username-input")).toBeEnabled();
  });

  it("omits tabs when only a single strategy is available", () => {
    render(<LoginForm {...baseProps} strategies={[multiStrategyConfig[0]!]} />);

    expect(screen.queryByTestId("login-strategy-tabs")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-username-input")).toBeEnabled();
  });
});
