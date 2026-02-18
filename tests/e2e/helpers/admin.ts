import type { Page } from "@playwright/test";

const DEFAULT_TENANT_ID = "tenant_qa";

type SessionOptions = {
  tenantId?: string;
  email?: string;
  name?: string;
  role?: "OWNER" | "WRITER" | "READER";
  assignMembership?: boolean;
};

export const createTestSession = async (page: Page, options: SessionOptions = {}) => {
  const response = await page.request.post("/api/test/session", {
    data: {
      tenantId: options.tenantId ?? DEFAULT_TENANT_ID,
      email: options.email,
      name: options.name,
      role: options.role,
      assignMembership: options.assignMembership,
    },
  });
  if (!response.ok()) {
    throw new Error(`Failed to create test session: ${response.status()}`);
  }
  const body = (await response.json()) as { sessionToken: string };
  return body.sessionToken;
};

export const authenticate = async (page: Page, sessionToken: string) => {
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
    },
  ]);
};

export const stubClipboard = async (page: Page) => {
  await page.addInitScript(() => {
    const store: { value: string } = { value: "" };
    const writeText = (text: string) => {
      store.value = text;
      (window as typeof window & { __mockClipboard?: string }).__mockClipboard = text;
      return Promise.resolve();
    };
    const stub = { writeText };
    if (navigator.clipboard) {
      navigator.clipboard.writeText = writeText;
      return;
    }
    Object.defineProperty(navigator, "clipboard", {
      value: stub,
      configurable: true,
    });
  });
};
