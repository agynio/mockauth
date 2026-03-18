import { env } from "@/server/env";

export type AuditRedactionState = {
  redactionEnabled: boolean;
  redactionRequested: boolean;
  productionGuardActive: boolean;
  allowUnredactedInProd: boolean;
  vercelEnv?: string;
};

type AuditRedactionInput = {
  vercelEnv?: string;
  redaction?: "on" | "off";
  allowUnredactedInProd?: boolean;
};

export const resolveAuditRedactionState = (input: AuditRedactionInput): AuditRedactionState => {
  const redactionRequested = input.redaction !== "off";
  const allowUnredactedInProd = input.allowUnredactedInProd ?? false;
  const productionGuardActive = input.vercelEnv === "production" && !allowUnredactedInProd;
  return {
    redactionEnabled: productionGuardActive ? true : redactionRequested,
    redactionRequested,
    productionGuardActive,
    allowUnredactedInProd,
    vercelEnv: input.vercelEnv,
  };
};

export const auditRedactionState = resolveAuditRedactionState({
  vercelEnv: process.env.VERCEL_ENV,
  redaction: env.AUDIT_LOG_REDACTION,
  allowUnredactedInProd: env.AUDIT_LOG_ALLOW_UNREDACTED_IN_PROD,
});
