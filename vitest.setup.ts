import "@testing-library/jest-dom/vitest";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";

const testEnvPath = path.resolve(process.cwd(), ".env.test");
if (existsSync(testEnvPath)) {
  config({ path: testEnvPath });
} else {
  config();
}

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

vi.mock("next/headers", () => {
  const cookieStore = new Map<string, string>();
  const headers = vi.fn(() => new Headers());
  return {
    headers,
    cookies: () => ({
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value ? { value } : undefined;
      },
      set: (name: string, value: string) => {
        cookieStore.set(name, value);
      },
    }),
  };
});

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
