import { prisma } from "../db/client.js";

export interface FraudCheckResult {
  checkType: string;
  result: "PASS" | "FLAG" | "FAIL";
  score?: number;
  details: Record<string, unknown>;
}

/**
 * Run all fraud checks for a redemption and persist results.
 * Returns { pass: true } if all pass; otherwise { pass: false, checks: [...] }.
 */
export async function runFraudChecks(redemptionId: string): Promise<{ pass: boolean; checks: FraudCheckResult[] }> {
  const redemption = await prisma.redemption.findUnique({ where: { id: redemptionId } });
  if (!redemption) throw new Error("Redemption not found");

  const checks: FraudCheckResult[] = [];
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const velocity = await prisma.redemption.aggregate({
    where: {
      externalUserId: redemption.externalUserId,
      status: { in: ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"] },
      requestedAt: { gte: since24h },
    },
    _count: { id: true },
  });

  const amountSum = await prisma.redemption.findMany({
    where: {
      externalUserId: redemption.externalUserId,
      status: { in: ["PENDING", "APPROVED", "PROCESSING", "COMPLETED"] },
      requestedAt: { gte: since24h },
    },
    select: { amount: true },
  });
  const totalAmount24h = amountSum.reduce((s, r) => s + parseFloat(r.amount), 0);

  const maxCount = parseInt(process.env.FRAUD_VELOCITY_MAX_COUNT_24H ?? "10", 10);
  const maxAmount = parseFloat(process.env.FRAUD_VELOCITY_MAX_AMOUNT_24H ?? "50000");
  const velocityPass = (maxCount <= 0 || velocity._count.id <= maxCount) && (maxAmount <= 0 || totalAmount24h <= maxAmount);
  checks.push({
    checkType: "VELOCITY",
    result: velocityPass ? "PASS" : "FLAG",
    score: velocityPass ? 0 : Math.min(100, (velocity._count.id / Math.max(1, maxCount)) * 50 + (totalAmount24h / Math.max(1, maxAmount)) * 50),
    details: { count24h: velocity._count.id, amount24h: totalAmount24h, maxCount, maxAmount },
  });

  await prisma.fraudCheck.create({
    data: {
      redemptionId,
      checkType: "VELOCITY",
      result: velocityPass ? "PASS" : "FLAG",
      score: velocityPass ? 0 : Math.min(100, Math.round((velocity._count.id / Math.max(1, maxCount)) * 50)),
      details: JSON.stringify(checks[0].details),
      checkedBy: "system",
    },
  });

  const pass = checks.every((c) => c.result === "PASS");
  return { pass, checks };
}

/**
 * Record a manual fraud check (e.g. after review).
 */
export async function recordManualFraudCheck(
  redemptionId: string,
  result: "PASS" | "FLAG" | "FAIL",
  details: Record<string, unknown>,
  actorId?: string
) {
  await prisma.fraudCheck.create({
    data: {
      redemptionId,
      checkType: "MANUAL",
      result,
      details: JSON.stringify(details),
      checkedBy: actorId ?? "system",
    },
  });
}

export async function getFraudChecks(redemptionId: string) {
  return prisma.fraudCheck.findMany({
    where: { redemptionId },
    orderBy: { checkedAt: "desc" },
  });
}
