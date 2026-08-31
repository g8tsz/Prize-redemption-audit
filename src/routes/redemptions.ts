import { Router } from "express";
import { z } from "zod";
import {
  createRedemption,
  updateRedemptionStatus,
  listRedemptions,
} from "../services/redemptionService.js";
import { getAuditChain } from "../services/redemptionAuditService.js";
import { getFraudChecks } from "../services/fraudService.js";
import { recordManualFraudCheck } from "../services/fraudService.js";
import { prisma } from "../db/client.js";

export const redemptionsRouter = Router();

const methodSchema = z.enum([
  "CRYPTO_WALLET",
  "BANK_TRANSFER",
  "SWEEPSTAKES_PRIZE",
  "GIFT_CARD",
  "CHECK",
  "OTHER",
]);
const statusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
]);

redemptionsRouter.post("/", async (req, res) => {
  const body = z
    .object({
      externalUserId: z.string().min(1),
      amount: z.string().refine((s) => !isNaN(parseFloat(s)) && parseFloat(s) > 0),
      currency: z.string().optional(),
      method: methodSchema,
      destination: z.string().optional().nullable(),
      metadata: z.record(z.unknown()).optional().nullable(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  try {
    const result = await createRedemption(body.data);
    return res.status(201).json(result);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

redemptionsRouter.get("/", async (req, res) => {
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;
  if (from && isNaN(from.getTime())) return res.status(400).json({ error: "Invalid from date" });
  if (to && isNaN(to.getTime())) return res.status(400).json({ error: "Invalid to date" });
  try {
    const result = await listRedemptions({
      externalUserId: req.query.externalUserId as string | undefined,
      status: req.query.status as string | undefined,
      method: req.query.method as string | undefined,
      fromDate: from,
      toDate: to,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
    });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

redemptionsRouter.get("/:id", async (req, res) => {
  try {
    const r = await prisma.redemption.findUnique({
      where: { id: req.params.id },
      include: {
        auditEntries: { orderBy: { createdAt: "asc" } },
        fraudChecks: { orderBy: { checkedAt: "desc" } },
        reconciliationMatches: { include: { run: true } },
      },
    });
    if (!r) return res.status(404).json({ error: "Redemption not found" });
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

redemptionsRouter.get("/:id/audit", async (req, res) => {
  try {
    const chain = await getAuditChain(req.params.id);
    return res.json({ entries: chain, verified: true });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

redemptionsRouter.get("/:id/fraud", async (req, res) => {
  try {
    const checks = await getFraudChecks(req.params.id);
    return res.json({ fraudChecks: checks });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

redemptionsRouter.patch("/:id/status", async (req, res) => {
  const body = z
    .object({
      status: statusSchema,
      payoutRef: z.string().optional(),
      rejectionReason: z.string().optional(),
      actorId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  try {
    await updateRedemptionStatus(req.params.id, body.data.status, {
      payoutRef: body.data.payoutRef,
      rejectionReason: body.data.rejectionReason,
      actorId: body.data.actorId,
    });
    return res.json({ status: body.data.status });
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
});

redemptionsRouter.post("/:id/fraud/manual", async (req, res) => {
  const body = z
    .object({
      result: z.enum(["PASS", "FLAG", "FAIL"]),
      details: z.record(z.unknown()).optional(),
      actorId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  try {
    await recordManualFraudCheck(
      req.params.id,
      body.data.result,
      body.data.details ?? {},
      body.data.actorId
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});
