import "dotenv/config";
import express from "express";
import { redemptionsRouter } from "./routes/redemptions.js";
import { reconciliationRouter } from "./routes/reconciliation.js";

const app = express();
const PORT = process.env.PORT ?? 3002;

app.use(express.json());

app.use("/api/redemptions", redemptionsRouter);
app.use("/api/reconciliation", reconciliationRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Prize redemption audit API listening on http://localhost:${PORT}`);
});
