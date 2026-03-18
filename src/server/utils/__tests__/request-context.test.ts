/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";

import { getRequestContext } from "@/server/utils/request-context";

describe("getRequestContext", () => {
  it("logs and rethrows header errors", async () => {
    const error = new Error("boom");
    vi.mocked(headers).mockImplementationOnce(() => {
      throw error;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getRequestContext()).rejects.toThrow("boom");

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to read request context",
      expect.objectContaining({ message: "boom" }),
    );

    errorSpy.mockRestore();
  });
});
