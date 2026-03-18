/* @vitest-environment node */

import { describe, expect, it } from "vitest";

import { resolveAuditRedactionState } from "@/server/services/audit-redaction";

describe("resolveAuditRedactionState", () => {
  it("respects AUDIT_LOG_REDACTION outside production", () => {
    const state = resolveAuditRedactionState({
      vercelEnv: "preview",
      redaction: "off",
      allowUnredactedInProd: false,
    });

    expect(state).toMatchObject({
      redactionEnabled: false,
      redactionRequested: false,
      productionGuardActive: false,
      allowUnredactedInProd: false,
      vercelEnv: "preview",
    });
  });

  it("forces redaction in production by default", () => {
    const state = resolveAuditRedactionState({
      vercelEnv: "production",
      redaction: "off",
      allowUnredactedInProd: false,
    });

    expect(state).toMatchObject({
      redactionEnabled: true,
      redactionRequested: false,
      productionGuardActive: true,
      allowUnredactedInProd: false,
      vercelEnv: "production",
    });
  });

  it("allows unredacted logging in production with override", () => {
    const state = resolveAuditRedactionState({
      vercelEnv: "production",
      redaction: "off",
      allowUnredactedInProd: true,
    });

    expect(state).toMatchObject({
      redactionEnabled: false,
      redactionRequested: false,
      productionGuardActive: false,
      allowUnredactedInProd: true,
      vercelEnv: "production",
    });
  });
});
