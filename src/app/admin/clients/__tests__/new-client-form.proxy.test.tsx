/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { NewClientForm } from "../new/client-form";
import { DEFAULT_PROXY_AUTH_STRATEGIES } from "@/server/oidc/proxy-auth-strategy";

const mockCreateClientAction = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/app/admin/actions", () => ({
  createClientAction: mockCreateClientAction,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/select", async () => await import("@/test-utils/mocks/shadcn-select"));

describe("NewClientForm proxy mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderForm = () => {
    const user = userEvent.setup();
    render(<NewClientForm tenantId="tenant_123" />);
    return user;
  };

  it("renders proxy provider fields and allows managing scope mappings", async () => {
    const user = renderForm();

    const proxyTab = screen.getByRole("tab", { name: "Proxy" });
    await user.click(proxyTab);
    expect(proxyTab).toHaveAttribute("data-state", "active");

    expect(screen.getByLabelText("Provider client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Authorization endpoint")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add mapping" }));

    const appScopeInputs = screen.getAllByLabelText("App scope");
    expect(appScopeInputs).toHaveLength(1);
    await user.type(appScopeInputs[0], "profile:read");
    await user.type(screen.getByLabelText("Provider scopes"), "openid profile");

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByLabelText("App scope")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    expect(screen.getAllByLabelText("App scope")).toHaveLength(1);
  });

  it("shows validation errors when proxy configuration is incomplete", async () => {
    const user = renderForm();

    await user.type(screen.getByLabelText("Client name"), "Proxy Validation");
    const proxyTab = screen.getByRole("tab", { name: "Proxy" });
    await user.click(proxyTab);
    expect(proxyTab).toHaveAttribute("data-state", "active");

    await user.click(screen.getByRole("button", { name: "Create client" }));

    await screen.findByText(/Authorization endpoint is required/i);
    await screen.findByText(/Token endpoint is required/i);
    await screen.findByText(/Provider client ID is required/i);

    expect(mockCreateClientAction).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("persists provider type selection and submits chosen value", async () => {
    const user = renderForm();

    mockCreateClientAction.mockResolvedValueOnce({ success: "Created" });

    await user.type(screen.getByLabelText("Client name"), "Proxy Provider");
    await user.click(screen.getByRole("tab", { name: "Proxy" }));

    const providerField = screen.getByText("Provider type").closest("div");
    expect(providerField).not.toBeNull();
    const providerSelect = within(providerField as HTMLElement).getByRole("combobox");
    expect(providerSelect).toHaveValue("oidc");

    await user.selectOptions(providerSelect, "oauth2");
    expect(providerSelect).toHaveValue("oauth2");

    await user.clear(screen.getByLabelText("Authorization endpoint"));
    await user.type(screen.getByLabelText("Authorization endpoint"), "https://idp.example.test/oauth2/auth");
    await user.clear(screen.getByLabelText("Token endpoint"));
    await user.type(screen.getByLabelText("Token endpoint"), "https://idp.example.test/oauth2/token");
    await user.clear(screen.getByLabelText("Provider client ID"));
    await user.type(screen.getByLabelText("Provider client ID"), "proxy-client");

    await user.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => expect(mockCreateClientAction).toHaveBeenCalledTimes(1));
    expect(mockCreateClientAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant_123",
        proxyAuthStrategies: DEFAULT_PROXY_AUTH_STRATEGIES,
        proxyConfig: expect.objectContaining({ providerType: "oauth2" }),
      }),
    );
  });

  it("submits normalized proxy configuration", async () => {
    const user = renderForm();

    mockCreateClientAction.mockResolvedValue({
      success: "Client created",
      data: { clientId: "client_generated", clientSecret: "secret_generated" },
    });

    await user.type(screen.getByLabelText("Client name"), "Proxy Demo");
    await user.click(screen.getByRole("tab", { name: "Proxy" }));

    await user.clear(screen.getByLabelText("Authorization endpoint"));
    await user.type(
      screen.getByLabelText("Authorization endpoint"),
      " https://idp.example.test/oauth2/authorize ",
    );
    await user.clear(screen.getByLabelText("Token endpoint"));
    await user.type(screen.getByLabelText("Token endpoint"), "https://idp.example.test/oauth2/token ");
    await user.clear(screen.getByLabelText("Provider client ID"));
    await user.type(screen.getByLabelText("Provider client ID"), " upstream-client ");
    await user.type(screen.getByLabelText("Provider client secret"), "secret-upstream");
    await user.type(
      screen.getByLabelText("Userinfo endpoint"),
      " https://idp.example.test/oauth2/userinfo ",
    );
    await user.type(screen.getByLabelText("JWKS URI"), " https://idp.example.test/oauth2/jwks.json ");

    await user.type(
      screen.getByLabelText("Default provider scopes"),
      "openid profile offline_access profile",
    );

    await user.click(screen.getByRole("button", { name: "Add mapping" }));
    await user.type(screen.getByLabelText("App scope"), " profile:read ");
    await user.type(screen.getByLabelText("Provider scopes"), "openid profile profile");

    await user.click(screen.getByLabelText("Passthrough prompt"));
    await user.click(screen.getByLabelText("Passthrough login_hint"));
    await user.click(screen.getByLabelText("Passthrough token payload"));

    await user.type(screen.getByLabelText("Redirect URIs"), "https://client.example.test/callback\n");

    await user.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => {
      expect(mockCreateClientAction).toHaveBeenCalledTimes(1);
    });

    expect(mockCreateClientAction).toHaveBeenCalledWith({
      tenantId: "tenant_123",
      name: "Proxy Demo",
      tokenEndpointAuthMethods: ["client_secret_basic"],
      pkceRequired: true,
      allowedGrantTypes: ["authorization_code"],
      redirects: ["https://client.example.test/callback"],
      postLogoutRedirects: [],
      mode: "proxy",
      proxyAuthStrategies: DEFAULT_PROXY_AUTH_STRATEGIES,
      proxyConfig: {
        providerType: "oidc",
        authorizationEndpoint: "https://idp.example.test/oauth2/authorize",
        tokenEndpoint: "https://idp.example.test/oauth2/token",
        userinfoEndpoint: "https://idp.example.test/oauth2/userinfo",
        jwksUri: "https://idp.example.test/oauth2/jwks.json",
        upstreamClientId: "upstream-client",
        upstreamClientSecret: "secret-upstream",
        upstreamTokenEndpointAuthMethod: "client_secret_basic",
        defaultScopes: ["openid", "profile", "offline_access"],
        scopeMapping: { "profile:read": ["openid", "profile"] },
        pkceSupported: true,
        oidcEnabled: true,
        promptPassthroughEnabled: true,
        loginHintPassthroughEnabled: true,
        passthroughTokenResponse: true,
      },
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: "Client created",
      description: "Client created",
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Provider client secret")).toHaveValue("");
      expect(screen.getByLabelText("Redirect URIs")).toHaveValue("");
    });

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Client ID")).toBeInTheDocument();
  });

  it("allows selecting upstream auth method and displays provider redirect", async () => {
    const user = renderForm();

    mockCreateClientAction.mockResolvedValue({
      success: "Client created",
      data: {
        clientId: "proxy-client",
        providerRedirectUri: "https://mockauth.test/r/api-default/oidc/proxy/callback",
      },
    });

    await user.type(screen.getByLabelText("Client name"), "Proxy Auth Method");
    await user.click(screen.getByRole("tab", { name: "Proxy" }));

    await user.type(screen.getByLabelText("Authorization endpoint"), "https://upstream.example.com/oauth2/auth");
    await user.type(screen.getByLabelText("Token endpoint"), "https://upstream.example.com/oauth2/token");
    await user.type(screen.getByLabelText("Provider client ID"), "proxy-upstream");

    const authField = screen.getByText("Token endpoint auth").closest("div");
    expect(authField).not.toBeNull();
    const authSelect = within(authField as HTMLElement).getByRole("combobox");
    expect(authSelect).toHaveValue("client_secret_basic");
    await user.selectOptions(authSelect, "client_secret_post");
    expect(authSelect).toHaveValue("client_secret_post");

    await user.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => expect(mockCreateClientAction).toHaveBeenCalledTimes(1));
    expect(mockCreateClientAction).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "proxy",
        proxyAuthStrategies: DEFAULT_PROXY_AUTH_STRATEGIES,
        proxyConfig: expect.objectContaining({
          upstreamTokenEndpointAuthMethod: "client_secret_post",
        }),
      }),
    );

    expect(screen.getByTestId("provider-redirect-uri")).toHaveTextContent(
      "https://mockauth.test/r/api-default/oidc/proxy/callback",
    );
  });
});
