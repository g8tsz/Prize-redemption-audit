import "dotenv/config";
import { prisma } from "../db/client.js";
import { verifyEntryHash } from "../lib/auditChain.js";

/**
 * Verify integrity of all audit chains. Exits 0 if all valid, 1 if any invalid.
 */
async function main() {
  const entries = await prisma.redemptionAuditEntry.findMany({
    orderBy: [{ redemptionId: "asc" }, { createdAt: "asc" }],
  });
  let invalid = 0;
  for (const e of entries) {
    const ok = verifyEntryHash({
      previousHash: e.previousHash,
      redemptionId: e.redemptionId,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
      entryHash: e.entryHash,
    });
    if (!ok) {
      console.error(`Invalid hash: entry ${e.id}, redemption ${e.redemptionId}`);
      invalid++;
    }
  }
  if (invalid > 0) {
    console.error(`Verification failed: ${invalid} invalid entries`);
    process.exit(1);
  }
  console.log(`Verified ${entries.length} audit entries`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
