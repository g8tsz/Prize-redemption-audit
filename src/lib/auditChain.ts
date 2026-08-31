import { createHash } from "crypto";

const ALGO = "sha256";
const ENCODING = "hex" as const;

/**
 * Compute hash for an audit entry. Chain: entryHash = H(previousHash || redemptionId || eventType || payload || createdAt)
 * First entry: previousHash = "0" (genesis).
 */
export function computeEntryHash(
  previousHash: string | null,
  redemptionId: string,
  eventType: string,
  payload: string,
  createdAt: Date
): string {
  const ts = createdAt.toISOString();
  const input = [previousHash ?? "0", redemptionId, eventType, payload, ts].join("|");
  return createHash(ALGO).update(input, "utf8").digest(ENCODING);
}

/**
 * Verify a single entry's hash given the previous entry's hash.
 */
export function verifyEntryHash(
  entry: { previousHash: string | null; redemptionId: string; eventType: string; payload: string; createdAt: Date; entryHash: string }
): boolean {
  const computed = computeEntryHash(
    entry.previousHash,
    entry.redemptionId,
    entry.eventType,
    entry.payload,
    entry.createdAt
  );
  return computed === entry.entryHash;
}
