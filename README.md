# Prize / Redemption Audit

Immutable audit log for every prize and redemption (sweepstakes and crypto casinos), with **reconciliation** against payment and KYC systems and **fraud checks**.

## Features

- **Immutable redemption log** – Every redemption records amount, user, timestamp, method (crypto, bank, sweepstakes prize, gift card, check). Status flow: PENDING → APPROVED → PROCESSING → COMPLETED (or REJECTED/FAILED/CANCELLED).
- **Hash-chained audit trail** – Every state change is appended to an audit chain; each entry stores `previousHash` and `entryHash = H(previousHash || redemptionId || eventType || payload || createdAt)`. Run `npm run audit:verify` to verify integrity.
- **Reconciliation** – Batch job matches redemptions to your payment/withdrawal system and KYC status. Results: MATCHED, UNMATCHED, KYC_BLOCKED, FRAUD_FLAGGED, PAYMENT_NOT_FOUND, AMOUNT_MISMATCH. Optional env: `PAYMENT_API_URL`, `PAYMENT_API_KEY`, `KYC_API_URL`, `KYC_API_KEY`.
- **Fraud checks** – On create: velocity (max redemptions count and amount per 24h per user). Configurable via `FRAUD_VELOCITY_MAX_COUNT_24H`, `FRAUD_VELOCITY_MAX_AMOUNT_24H`. Manual fraud check endpoint for review. All checks stored and linked to redemption.

## Data model

- **Redemption** – externalUserId, amount, currency, method, status, destination, payoutRef, requestedAt, completedAt, metadata, reconciliationRunId.
- **RedemptionAuditEntry** – redemptionId, eventType, payload (JSON), previousEntryId, previousHash, entryHash, actorId, createdAt. Append-only; chain per redemption.
- **ReconciliationRun** – startedAt, completedAt, status, summary (JSON). One per batch run.
- **ReconciliationMatch** – redemptionId, runId, status (MATCHED | …), externalTxId, kycStatus, amountMatched, notes.
- **FraudCheck** – redemptionId, checkType (VELOCITY | KYC | SANCTIONS | MANUAL), result (PASS | FLAG | FAIL), score, details (JSON), checkedAt.

## Setup

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
```

## Run

```bash
npm run dev
# or
npm run build && npm start
```

API base: `http://localhost:3002`

## API

### Redemptions

- `POST /api/redemptions` – Create redemption. Body: `externalUserId`, `amount`, `currency?`, `method` (CRYPTO_WALLET | BANK_TRANSFER | SWEEPSTAKES_PRIZE | GIFT_CARD | CHECK | OTHER), `destination?`, `metadata?`. Runs fraud checks; returns `redemption` and optional `fraudResult` if flagged.
- `GET /api/redemptions` – List. Query: `externalUserId`, `status`, `method`, `from`, `to`, `limit`, `offset`.
- `GET /api/redemptions/:id` – Get one with audit entries, fraud checks, reconciliation matches.
- `GET /api/redemptions/:id/audit` – Get full audit chain for verification.
- `GET /api/redemptions/:id/fraud` – List fraud checks for redemption.
- `PATCH /api/redemptions/:id/status` – Update status. Body: `status`, `payoutRef?`, `rejectionReason?`, `actorId?`. Valid transitions enforced; appends to audit chain.
- `POST /api/redemptions/:id/fraud/manual` – Record manual fraud check. Body: `result` (PASS | FLAG | FAIL), `details?`, `actorId?`.

### Reconciliation

- `POST /api/reconciliation/run` – Run reconciliation. Body: `from?`, `to?` (ISO dates; default last 7 days). Fetches withdrawals from PAYMENT_API_URL and KYC from KYC_API_URL; creates ReconciliationRun and ReconciliationMatch rows; appends RECONCILED audit entry per redemption.
- `GET /api/reconciliation/runs` – List runs. Query: `limit`.
- `GET /api/reconciliation/runs/:runId` – Get run with matches.
- `GET /api/reconciliation/match?redemptionId=&runId=` – Get match for a redemption in a run.

### Health

- `GET /health` – `{ "status": "ok" }`.

## Scripts

- `npm run audit:verify` – Verify all audit entry hashes (chain integrity). Exit 0 if valid, 1 if any invalid.
- `npm run reconcile:run` – Run reconciliation job (default date range).

## Payment / KYC integration

- **Payment API** – Reconciliation expects `GET /withdrawals?from=&to=` returning `{ withdrawals: [ { id, userId, amount, currency, status, createdAt } ] }`. Set `PAYMENT_API_URL` and `PAYMENT_API_KEY`.
- **KYC API** – Expects `GET /subject/:externalUserId/status` (or similar) returning `{ status: "APPROVED" | "PENDING" | "REJECTED" }`. Set `KYC_API_URL` and `KYC_API_KEY`. If unset, KYC is treated as UNKNOWN and not blocking.

## Pushing to GitHub

Repo: [g8tsz/Prize-redemption-audit](https://github.com/g8tsz/Prize-redemption-audit)

```bash
git init
git add .
git commit -m "Prize/redemption audit: immutable log, reconciliation, fraud checks"
git remote add origin https://github.com/g8tsz/Prize-redemption-audit.git
git branch -M main
git push -u origin main
```

## Security notes

- Audit entries are append-only; do not update or delete. Verify chain periodically with `audit:verify`.
- Restrict status updates and reconciliation to authenticated admins or internal services.
- Use HTTPS and secure API keys; consider rate limiting and idempotency keys for redemption creation.
