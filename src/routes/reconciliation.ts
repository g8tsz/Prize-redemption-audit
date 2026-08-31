import { Router } from "express";
import { prisma } from "../db/client.js";
import { runReconciliation, getReconciliationRuns, getReconciliationMatch } from "../services/reconciliationService.js";

export const reconciliationRouter = Router();

reconciliationRouter.post("/run", async (req, res) => {
  const from = req.body?.from ? new Date(req.body.from) : undefined;
  const to = req.body?.to ? new Date(req.body.to) : undefined;
  try {
    const result = await runReconciliation({ from, to });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

reconciliationRouter.get("/runs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  try {
    const runs = await getReconciliationRuns(limit);
    return res.json({ runs });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

reconciliationRouter.get("/runs/:runId", async (req, res) => {
  try {
    const run = await prisma.reconciliationRun.findUnique({
      where: { id: req.params.runId },
      include: { matches: true },
    });
    if (!run) return res.status(404).json({ error: "Run not found" });
    return res.json(run);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

reconciliationRouter.get("/match", async (req, res) => {
  const redemptionId = req.query.redemptionId as string;
  const runId = req.query.runId as string;
  if (!redemptionId || !runId) return res.status(400).json({ error: "redemptionId and runId required" });
  try {
    const match = await getReconciliationMatch(redemptionId, runId);
    if (!match) return res.status(404).json({ error: "Match not found" });
    return res.json(match);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});
