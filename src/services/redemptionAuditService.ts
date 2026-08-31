import { prisma } from "../db/client.js";
import { computeEntryHash } from "../lib/auditChain.js";

export type RedemptionEventType =
  | "CREATED"
  | "STATUS_CHANGED"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "RECONCILED"
  | "FRAUD_CHECK"
  | "AMOUNT_UPDATED"
  | "DESTINATION_UPDATED";

/**
 * Append an immutable audit entry for a redemption. Builds hash chain (previousEntryId + previousHash).
 * Returns the new entry.
 */
export async function appendAuditEntry(
  redemptionId: string,
  eventType: RedemptionEventType,
  payload: Record<string, unknown>,
  actorId?: string | null
): Promise<{ id: string; entryHash: string }> {
  const payloadStr = JSON.stringify(payload);

  const lastEntry = await prisma.redemptionAuditEntry.findFirst({
    where: { redemptionId },
    orderBy: { createdAt: "desc" },
    select: { id: true, entryHash: true },
  });

  const createdAt = new Date();
  const previousHash = lastEntry?.entryHash ?? null;
  const entryHash = computeEntryHash(previousHash, redemptionId, eventType, payloadStr, createdAt);

  const entry = await prisma.redemptionAuditEntry.create({
    data: {
      redemptionId,
      eventType,
      payload: payloadStr,
      previousEntryId: lastEntry?.id ?? null,
      previousHash,
      entryHash,
      actorId: actorId ?? null,
    },
  });

  return { id: entry.id, entryHash: entry.entryHash };
}

/**
 * Get full audit chain for a redemption (for verification or display).
 */
export async function getAuditChain(redemptionId: string) {
  return prisma.redemptionAuditEntry.findMany({
    where: { redemptionId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get the latest audit entry hash for a redemption (for chaining to next redemption's chain or global verification).
 */
export async function getLatestEntryHash(redemptionId: string): Promise<string | null> {
  const e = await prisma.redemptionAuditEntry.findFirst({
    where: { redemptionId },
    orderBy: { createdAt: "desc" },
    select: { entryHash: true },
  });
  return e?.entryHash ?? null;
}
