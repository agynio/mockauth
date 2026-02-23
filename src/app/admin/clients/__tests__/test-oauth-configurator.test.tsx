/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TestOAuthConfigurator } from "../[clientId]/test/test-oauth-configurator";

const mockPrepare = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "ok", data: { authorizationUrl: "https://auth.example.test" } }));
const mockAddRedirect = vi.hoisted(() => vi.fn().mockResolvedValue({ success: "added" }));
const mockToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("@/app/admin/actions", () => ({
  prepareClientOauthTestAction: mockPrepare,
  addRedirectUriAction: mockAddRedirect,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const defaultProps = {
  clientId: "client_123",
  defaultScopes: "openid profile",
  defaultRedirectUri: "https://admin.example.test/callback",
  canManageRedirects: true,
  redirectAllowed: false,
  requiresClientSecret: false,
  defaultClientSecret: undefined,
};

describe("TestOAuthConfigurator", () => {
  beforeEach(() => {
    mockPrepare.mockClear();
    mockAddRedirect.mockClear();
    mockToast.mockClear();
    mockPush.mockClear();
  });

  it("adds the admin test redirect when requested", async () => {
    const user = userEvent.setup();
    render(<TestOAuthConfigurator {...defaultProps} />);
    const notice = screen.getByTestId("test-oauth-warning");
    expect(notice).toBeVisible();
    expect(screen.queryByTestId("test-oauth-secret-input")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("test-oauth-add-redirect"));
    await waitFor(() => {
      expect(mockAddRedirect).toHaveBeenCalledWith({ clientId: "client_123", uri: "https://admin.example.test/callback" });
    });
  });

  it("submits the form with the provided client secret", async () => {
    const user = userEvent.setup();
    render(
      <TestOAuthConfigurator
        {...defaultProps}
        redirectAllowed
        requiresClientSecret
        defaultClientSecret="stored-secret"
      />,
    );

    const secretInput = screen.getByTestId("test-oauth-secret-input") as HTMLInputElement;
    expect(secretInput).toHaveValue("stored-secret");
    await user.clear(secretInput);
    await user.type(secretInput, "override-secret");
    await user.click(screen.getByTestId("test-oauth-start"));

    await waitFor(() => {
      expect(mockPrepare).toHaveBeenCalledWith({
        clientId: "client_123",
        scopes: "openid profile",
        redirectUri: "https://admin.example.test/callback",
        clientSecret: "override-secret",
      });
      expect(mockPush).toHaveBeenCalledWith("https://auth.example.test");
    });

    expect(screen.getByTestId("test-oauth-authorization-url")).toHaveTextContent("https://auth.example.test");
  });

  it("prevents confidential runs without a secret", async () => {
    const user = userEvent.setup();
    render(
      <TestOAuthConfigurator
        {...defaultProps}
        redirectAllowed
        requiresClientSecret
        defaultClientSecret="stored-secret"
      />,
    );

    const secretInput = screen.getByTestId("test-oauth-secret-input") as HTMLInputElement;
    await user.clear(secretInput);
    await user.click(screen.getByTestId("test-oauth-start"));

    expect(mockPrepare).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Client secret is required")).toBeVisible();
    });
  });

  it("copies the client secret", async () => {
    const user = userEvent.setup();
    render(
      <TestOAuthConfigurator
        {...defaultProps}
        redirectAllowed
        requiresClientSecret
        defaultClientSecret="stored-secret"
      />,
    );

    const copyButton = screen.getByTestId("test-oauth-secret-copy");
    expect(copyButton).toBeEnabled();
    await user.click(copyButton);
    await waitFor(() => {
      expect(copyButton).toHaveTextContent("Copied");
    });
  });

  it("surfaces action errors via toast", async () => {
    mockPrepare.mockResolvedValueOnce({ error: "Redirect missing" });
    const user = userEvent.setup();
    render(<TestOAuthConfigurator {...defaultProps} redirectAllowed />);

    await user.click(screen.getByTestId("test-oauth-start"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Unable to generate URL",
        description: "Redirect missing",
      });
    });
  });
});
