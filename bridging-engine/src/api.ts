import express from "express";
import cors    from "cors";
import {
  getUserTxsWithStatus,
  saveUserTx,
  patchUserTx,
  clearUserTxs,
  UserTx,
} from "./store.js";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/transactions?address=0x…
 * Returns up to 50 user transactions with live status joined from the relayer.
 */
app.get("/api/transactions", async (req, res) => {
  const address = req.query.address as string | undefined;
  if (!address) {
    res.status(400).json({ error: "address query param required" });
    return;
  }
  try {
    const txs = await getUserTxsWithStatus(address);
    res.json(txs);
  } catch (err) {
    console.error("[API] GET /api/transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/transactions
 * Frontend calls this after the user submits a bridge transaction.
 * Body must match the UserTx shape (minus relayer-owned fields).
 */
app.post("/api/transactions", async (req, res) => {
  const body = req.body as Partial<UserTx>;

  if (!body.tempId || !body.userAddress) {
    res.status(400).json({ error: "tempId and userAddress are required" });
    return;
  }

  const tx: UserTx = {
    tempId:        body.tempId,
    userAddress:   body.userAddress,
    txId:          body.txId          ?? null,
    approveTxHash: body.approveTxHash ?? null,
    lockTxHash:    body.lockTxHash    ?? null,
    burnTxHash:    body.burnTxHash    ?? null,
    direction:     body.direction     ?? "forward",
    amount:        body.amount        ?? "0",
    sourceChain:   body.sourceChain   ?? "",
    destChain:     body.destChain     ?? "",
    timestamp:     body.timestamp     ?? Date.now(),
  };

  try {
    await saveUserTx(tx);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[API] POST /api/transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /api/transactions/:tempId
 * Frontend patches user-owned fields (txId, approveTxHash, lockTxHash, burnTxHash).
 */
app.patch("/api/transactions/:tempId", async (req, res) => {
  const { tempId } = req.params;
  const patch = req.body as Partial<UserTx>;

  try {
    await patchUserTx(tempId, patch);
    res.json({ ok: true });
  } catch (err) {
    console.error("[API] PATCH /api/transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/transactions?address=0x…
 * Clears all user_transactions for a wallet address.
 */
app.delete("/api/transactions", async (req, res) => {
  const address = req.query.address as string | undefined;
  if (!address) {
    res.status(400).json({ error: "address query param required" });
    return;
  }
  try {
    await clearUserTxs(address);
    res.json({ ok: true });
  } catch (err) {
    console.error("[API] DELETE /api/transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

export function startApi(port = 4000): () => void {
  const server = app.listen(port, () => {
    console.log(`[API] Listening on port ${port}`);
  });

  return function stopApi() {
    server.close(() => console.log("[API] Server closed."));
  };
}
