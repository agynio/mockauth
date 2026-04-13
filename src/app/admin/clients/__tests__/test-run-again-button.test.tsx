/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TestRunAgainButton } from "../[clientId]/test/test-run-again-button";

const mockPrepare = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { authorizationUrl: "https://auth.example.test" } }));
const mockToast = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/app/admin/actions", () => ({
  prepareClientOauthTestAction: mockPrepare,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/app/admin/clients/[clientId]/test/navigation", () => ({
  navigateTo: mockNavigate,
}));

describe("TestRunAgainButton", () => {
  beforeEach(() => {
    mockPrepare.mockClear();
    mockToast.mockClear();
    mockNavigate.mockClear();
  });

  it("restarts the OAuth test using prior settings", async () => {
    const user = userEvent.setup();
    render(<TestRunAgainButton clientId="client_123" scopes="openid" redirectUri="https://admin.example.test/callback" />);

    await user.click(screen.getByTestId("test-oauth-run-again"));

    await waitFor(() => {
      expect(mockPrepare).toHaveBeenCalledWith({
        clientId: "client_123",
        scopes: "openid",
        redirectUri: "https://admin.example.test/callback",
        promptLogin: false,
      });
      expect(mockNavigate).toHaveBeenCalledWith("https://auth.example.test");
    });
  });

  it("surfaces action errors via toast", async () => {
    mockPrepare.mockResolvedValueOnce({ error: "Client missing" });
    const user = userEvent.setup();
    render(<TestRunAgainButton clientId="client_123" scopes="openid" redirectUri="https://admin.example.test/callback" />);

    await user.click(screen.getByTestId("test-oauth-run-again"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Unable to restart test",
        description: "Client missing",
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it("handles thrown errors", async () => {
    mockPrepare.mockRejectedValueOnce(new Error("Network down"));
    const user = userEvent.setup();
    render(<TestRunAgainButton clientId="client_123" scopes="openid" redirectUri="https://admin.example.test/callback" />);

    await user.click(screen.getByTestId("test-oauth-run-again"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Unable to restart test",
        description: "Network down",
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it("supports custom labels and test ids", async () => {
    const user = userEvent.setup();
    render(
      <TestRunAgainButton clientId="client_123" scopes="openid" redirectUri="https://admin.example.test/callback" testId="test-reset">
        Reset test
      </TestRunAgainButton>,
    );

    await user.click(screen.getByTestId("test-reset"));

    await waitFor(() => {
      expect(mockPrepare).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("https://auth.example.test");
    });
  });
});
