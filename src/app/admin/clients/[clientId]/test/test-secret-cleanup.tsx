"use client";

import { useEffect } from "react";

type Props = {
  clientId: string;
  state: string | null | undefined;
  enabled: boolean;
};

export function TestSecretCleanup({ clientId, state, enabled }: Props) {
  useEffect(() => {
    if (!enabled || !state) {
      return;
    }
    const controller = new AbortController();
    const cleanup = async () => {
      try {
        await fetch(`/admin/clients/${clientId}/test/secret`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
          signal: controller.signal,
        });
      } catch {
        // ignore cleanup errors
      }
    };
    cleanup();
    return () => controller.abort();
  }, [clientId, enabled, state]);

  return null;
}
