import { prisma } from "../db/client.js";
import { appendAuditEntry, type RedemptionEventType } from "./redemptionAuditService.js";
import { runFraudChecks } from "./fraudService.js";

export type RedemptionMethod =
  | "CRYPTO_WALLET"
  | "BANK_TRANSFER"
  | "SWEEPSTAKES_PRIZE"
  | "GIFT_CARD"
  | "CHECK"
  | "OTHER";

export type RedemptionStatus =
  | "PENDING"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "REJECTED"
  | "FAILED"
  | "CANCELLED";

const VALID_METHODS: RedemptionMethod[] = [
  "CRYPTO_WALLET",
  "BANK_TRANSFER",
  "SWEEPSTAKES_PRIZE",
  "GIFT_CARD",
  "CHECK",
  "OTHER",
];
const VALID_STATUSES: RedemptionStatus[] = [
  "PENDING",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
];

export function isAllowedStatusTransition(from: string, to: string): boolean {
  const map: Record<string, string[]> = {
    PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED: ["PROCESSING", "REJECTED", "CANCELLED"],
    PROCESSING: ["COMPLETED", "FAILED"],
    COMPLETED: [],
    REJECTED: [],
    FAILED: [],
    CANCELLED: [],
  };
  return map[from]?.includes(to) ?? false;
}

export async function createRedemption(params: {
  externalUserId: string;
  amount: string;
  currency?: string;
  method: string;
  destination?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ redemption: { id: string; status: string }; fraudResult?: { pass: boolean; checks: unknown[] } }> {
  const method = VALID_METHODS.includes(params.method as RedemptionMethod) ? params.method : "OTHER";
  const amount = String(parseFloat(params.amount));
  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) throw new Error("Invalid amount");

  const redemption = await prisma.redemption.create({
    data: {
      externalUserId: params.externalUserId.trim(),
      amount,
      currency: params.currency ?? "USD",
      method,
      status: "PENDING",
      destination: params.destination?.trim() ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });

  await appendAuditEntry(redemption.id, "CREATED", {
    amount: redemption.amount,
    currency: redemption.currency,
    method: redemption.method,
    destination: redemption.destination,
    metadata: redemption.metadata,
    status: redemption.status,
  });

  const fraudResult = await runFraudChecks(redemption.id);
  if (!fraudResult.pass) {
    await appendAuditEntry(redemption.id, "FRAUD_CHECK", {
      result: "FLAGGED",
      checks: fraudResult.checks,
    });
  }

  return {
    redemption: { id: redemption.id, status: redemption.status },
    fraudResult: fraudResult.pass ? undefined : { pass: false, checks: fraudResult.checks },
  };
}

export async function updateRedemptionStatus(
  redemptionId: string,
  newStatus: RedemptionStatus,
  opts?: { payoutRef?: string; rejectionReason?: string; actorId?: string }
): Promise<{ success: boolean }> {
  const redemption = await prisma.redemption.findUnique({ where: { id: redemptionId } });
  if (!redemption) throw new Error("Redemption not found");
  if (!isAllowedStatusTransition(redemption.status, newStatus)) {
    throw new Error(`Invalid status transition: ${redemption.status} -> ${newStatus}`);
  }

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === "COMPLETED" || newStatus === "FAILED") {
    (updateData as { completedAt: Date }).completedAt = new Date();
  }
  if (newStatus === "APPROVED") {
    (updateData as { approvedAt: Date; approvedBy: string | null }).approvedAt = new Date();
    (updateData as { approvedBy: string | null }).approvedBy = opts?.actorId ?? null;
  }
  if (opts?.payoutRef) (updateData as { payoutRef: string }).payoutRef = opts.payoutRef;
  if (opts?.rejectionReason) (updateData as { rejectionReason: string }).rejectionReason = opts.rejectionReason;

  await prisma.redemption.update({
    where: { id: redemptionId },
    data: updateData as Parameters<typeof prisma.redemption.update>[0]["data"],
  });

  const eventType: RedemptionEventType =
    newStatus === "APPROVED" ? "APPROVED" :
    newStatus === "REJECTED" ? "REJECTED" :
    newStatus === "COMPLETED" ? "COMPLETED" :
    newStatus === "FAILED" ? "FAILED" : "STATUS_CHANGED";

  await appendAuditEntry(
    redemptionId,
    eventType,
    {
      previousStatus: redemption.status,
      newStatus,
      payoutRef: opts?.payoutRef,
      rejectionReason: opts?.rejectionReason,
      actorId: opts?.actorId,
    },
    opts?.actorId
  );

  return { success: true };
}

export async function listRedemptions(filters: {
  externalUserId?: string;
  status?: string;
  method?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters.externalUserId) where.externalUserId = filters.externalUserId.trim();
  if (filters.status) where.status = filters.status;
  if (filters.method) where.method = filters.method;
  if (filters.fromDate || filters.toDate) {
    where.requestedAt = {};
    if (filters.fromDate) (where.requestedAt as Record<string, Date>).gte = filters.fromDate;
    if (filters.toDate) (where.requestedAt as Record<string, Date>).lte = filters.toDate;
  }

  const [items, total] = await Promise.all([
    prisma.redemption.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      take: Math.min(filters.limit ?? 50, 100),
      skip: filters.offset ?? 0,
      include: {
        auditEntries: { orderBy: { createdAt: "asc" }, take: 100 },
        fraudChecks: true,
      },
    }),
    prisma.redemption.count({ where }),
  ]);

  return { redemptions: items, total };
}
