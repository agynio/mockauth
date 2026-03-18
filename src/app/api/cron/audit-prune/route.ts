import { subDays } from "date-fns";

import { prisma } from "@/server/db/client";
import { env } from "@/server/env";

const BATCH_SIZE = 1000;
const MAX_BATCHES = 25;

export const POST = async (request: Request) => {
  if (!env.CRON_SECRET) {
    return Response.json({ error: "Cron secret not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const retentionDays = env.AUDIT_LOG_RETENTION_DAYS;
  const cutoff = subDays(new Date(), retentionDays);
  let deletedTotal = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const deleted = await prisma.$executeRaw`
      WITH to_delete AS (
        SELECT id
        FROM "AuditLog"
        WHERE "createdAt" < ${cutoff}
        ORDER BY "createdAt" ASC
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM "AuditLog"
      WHERE id IN (SELECT id FROM to_delete);
    `;
    const count = Number(deleted);
    if (!Number.isFinite(count) || count <= 0) {
      break;
    }
    deletedTotal += count;
    if (count < BATCH_SIZE) {
      break;
    }
  }

  return Response.json({ deleted: deletedTotal, retentionDays, cutoff: cutoff.toISOString() });
};
