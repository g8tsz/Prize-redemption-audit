import "dotenv/config";
import { runReconciliation } from "../services/reconciliationService.js";

async function main() {
  const result = await runReconciliation();
  console.log("Reconciliation complete:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
