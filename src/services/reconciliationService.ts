import { prisma } from "../db/client.js";
import { appendAuditEntry } from "./redemptionAuditService.js";

export type MatchStatus =
  | "MATCHED"
  | "UNMATCHED"
  | "KYC_BLOCKED"
  | "FRAUD_FLAGGED"
  | "PAYMENT_NOT_FOUND"
  | "AMOUNT_MISMATCH";

interface PaymentSystemWithdrawal {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
}

/**
 * Fetch withdrawals from payment API (stub: implement per your payment system).
 */
async function fetchPaymentWithdrawals(from: Date, to: Date): Promise<PaymentSystemWithdrawal[]> {
  const url = process.env.PAYMENT_API_URL;
  const key = process.env.PAYMENT_API_KEY;
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/withdrawals?from=${from.toISOString()}&to=${to.toISOString()}`,
      { headers: { Authorization: `Bearer ${key}`, "X-API-Key": key } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { withdrawals?: PaymentSystemWithdrawal[] };
    return data.withdrawals ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch KYC status for user (stub: implement per your KYC system).
 */
async function fetchKycStatus(externalUserId: string): Promise<"APPROVED" | "PENDING" | "REJECTED" | "UNKNOWN"> {
  const url = process.env.KYC_API_URL;
  const key = process.env.KYC_API_KEY;
  if (!url || !key) return "UNKNOWN";
  try {
    const res = await fetch(`${url}/subject/${encodeURIComponent(externalUserId)}/status`, {
      headers: { Authorization: `Bearer ${key}`, "X-API-Key": key },
    });
    if (!res.ok) return "UNKNOWN";
    const data = (await res.json()) as { status?: string };
    const s = (data.status ?? "").toUpperCase();
    if (["APPROVED", "PENDING", "REJECTED"].includes(s)) return s as "APPROVED" | "PENDING" | "REJECTED";
    return "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Run reconciliation: match redemptions (COMPLETED or PENDING/APPROVED) to payment system and KYC.
 */
export async function runReconciliation(opts?: { from?: Date; to?: Date }): Promise<{
  runId: string;
  status: string;
  summary: { matched: number; unmatched: number; kycBlocked: number; fraudFlagged: number; paymentNotFound: number; amountMismatch: number; errors: string[] };
}> {
  const to = opts?.to ?? new Date();
  const from = opts?.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const run = await prisma.reconciliationRun.create({
    data: { status: "RUNNING" },
  });

  const redemptions = await prisma.redemption.findMany({
    where: {
      requestedAt: { gte: from, lte: to },
      status: { in: ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"] },
    },
    include: { fraudChecks: { where: { result: "FLAG" }, take: 1 } },
  });

  const withdrawals = await fetchPaymentWithdrawals(from, to);
  const summary = {
    matched: 0,
    unmatched: 0,
    kycBlocked: 0,
    fraudFlagged: 0,
    paymentNotFound: 0,
    amountMismatch: 0,
    errors: [] as string[],
  };

  for (const r of redemptions) {
    let status: MatchStatus = "UNMATCHED";
    let externalTxId: string | null = null;
    let kycStatus: string | null = null;
    let amountMatched: boolean | null = null;
    let notes: string | null = null;

    const kyc = await fetchKycStatus(r.externalUserId);
    kycStatus = kyc;
    if (kyc === "REJECTED" || kyc === "PENDING") {
      status = "KYC_BLOCKED";
      summary.kycBlocked++;
    } else if (r.fraudChecks.length > 0) {
      status = "FRAUD_FLAGGED";
      summary.fraudFlagged++;
    } else {
      const match = withdrawals.find(
        (w) => w.userId === r.externalUserId && w.amount === r.amount && w.currency === r.currency
      );
      if (match) {
        status = "MATCHED";
        externalTxId = match.id;
        amountMatched = true;
        summary.matched++;
      } else {
        const anyPayment = withdrawals.find((w) => w.userId === r.externalUserId);
        if (!anyPayment) {
          status = "PAYMENT_NOT_FOUND";
          summary.paymentNotFound++;
        } else {
          status = "AMOUNT_MISMATCH";
          amountMatched = false;
          notes = `Expected ${r.amount} ${r.currency}`;
          summary.amountMismatch++;
        }
      }
    }

    await prisma.reconciliationMatch.upsert({
      where: {
        redemptionId_runId: { redemptionId: r.id, runId: run.id },
      },
      create: {
        redemptionId: r.id,
        runId: run.id,
        status,
        externalTxId,
        externalUserId: r.externalUserId,
        kycStatus,
        amountMatched,
        notes,
      },
      update: {
        status,
        externalTxId: externalTxId ?? undefined,
        kycStatus: kycStatus ?? undefined,
        amountMatched: amountMatched ?? undefined,
        notes: notes ?? undefined,
      },
    });

    await prisma.redemption.update({
      where: { id: r.id },
      data: { reconciliationRunId: run.id },
    });

    await appendAuditEntry(r.id, "RECONCILED", {
      runId: run.id,
      matchStatus: status,
      externalTxId,
      kycStatus,
    });
  }

  await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      summary: JSON.stringify(summary),
    },
  });

  return {
    runId: run.id,
    status: "COMPLETED",
    summary,
  };
}

export async function getReconciliationRuns(limit = 20) {
  return prisma.reconciliationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { _count: { select: { matches: true } } },
  });
}

export async function getReconciliationMatch(redemptionId: string, runId: string) {
  return prisma.reconciliationMatch.findUnique({
    where: { redemptionId_runId: { redemptionId, runId } },
    include: { run: true },
  });
}
