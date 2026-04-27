"use client";

import { useState, useEffect, useCallback } from "react";

const API       = process.env.NEXT_PUBLIC_API_URL ?? "";
const LOCAL_KEY = "bridge_tx_history";   // fallback when wallet not connected
const MAX_TXS   = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Status values.
 *  "pending"   — tx submitted, relayer hasn't confirmed yet
 *  "completed" — relayer minted / unlocked successfully
 *  "failed"    — relayer failed after all retries
 *
 * "minted" / "unlocked" are kept as aliases so the existing UI code and
 * useResumePendingTxs don't need to be changed.
 */
export type TxStatus = "pending" | "completed" | "minted" | "unlocked" | "failed";

export interface StoredTx {
  // ── Frontend-owned fields ──────────────────────────────────────────────────
  id:             string;   // == tempId
  tempId:         string;   // frontend UUID; exists before txId is known
  timestamp:      number;
  amount:         string;
  direction:      "forward" | "reverse";
  approveTxHash:  string | null;   // ERC-20 approval — only frontend knows
  lockTxHash:     string | null;   // user's lock tx hash
  burnTxHash:     string | null;   // user's burn tx hash
  /** lockId (forward) or burnId (reverse). Replaces the old lockId/burnId pair. */
  txId:           string | null;
  sourceChain:    string;
  destChain:      string;

  // ── Relayer-owned fields (read-only from backend) ─────────────────────────
  /** Authoritative status from the relayer.  Defaults to "pending" until the
   *  relayer writes to the transactions collection. */
  status:         TxStatus;
  mintTxHash:     string | null;   // relayer's mint tx (forward bridge)
  unlockTxHash:   string | null;   // relayer's unlock tx (reverse bridge)
  error:          string | null;
}

/** Fields the frontend is allowed to persist to the backend. */
type UserOwnedPatch = Pick<StoredTx, "txId" | "approveTxHash" | "lockTxHash" | "burnTxHash">;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransactionHistory(userAddress?: string) {
  const [txs, setTxs] = useState<StoredTx[]>([]);

  // ── Load on mount / address change ────────────────────────────────────────
  useEffect(() => {
    if (userAddress && API) {
      fetch(`${API}/api/transactions?address=${userAddress}`)
        .then((r) => r.json())
        .then((data: StoredTx[]) => {
          // Normalise: map backend's "completed" to direction-specific alias
          // so existing UI code still works.
          const normalised = data.map(normaliseStatus).slice(0, MAX_TXS);
          setTxs(normalised);
        })
        .catch(() => loadFromLocal());
    } else {
      loadFromLocal();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress]);

  function loadFromLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) setTxs((JSON.parse(raw) as StoredTx[]).slice(0, MAX_TXS));
    } catch { /* ignore */ }
  }

  // ── Add ───────────────────────────────────────────────────────────────────
  const addTx = useCallback((tx: StoredTx) => {
    setTxs((prev) => [tx, ...prev].slice(0, MAX_TXS));

    if (userAddress && API) {
      fetch(`${API}/api/transactions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        // Only send the user-owned fields — status comes from the relayer.
        body: JSON.stringify({
          tempId:        tx.tempId,
          userAddress,
          txId:          tx.txId,
          approveTxHash: tx.approveTxHash,
          lockTxHash:    tx.lockTxHash,
          burnTxHash:    tx.burnTxHash,
          direction:     tx.direction,
          amount:        tx.amount,
          sourceChain:   tx.sourceChain,
          destChain:     tx.destChain,
          timestamp:     tx.timestamp,
        }),
      }).catch(() => {});
    } else {
      try {
        const raw  = localStorage.getItem(LOCAL_KEY);
        const prev = raw ? (JSON.parse(raw) as StoredTx[]) : [];
        localStorage.setItem(LOCAL_KEY, JSON.stringify([tx, ...prev].slice(0, MAX_TXS)));
      } catch { /* quota */ }
    }
  }, [userAddress]);

  // ── Update ────────────────────────────────────────────────────────────────
  const updateTx = useCallback((tempId: string, patch: Partial<StoredTx>) => {
    // Always update local state (drives real-time UI during active bridge).
    setTxs((prev) => prev.map((t) => t.tempId === tempId ? { ...t, ...patch } : t));

    // For the backend, only send user-owned fields.
    const userPatch: Partial<UserOwnedPatch> = {};
    if ("txId"          in patch) userPatch.txId          = patch.txId          ?? null;
    if ("approveTxHash" in patch) userPatch.approveTxHash = patch.approveTxHash ?? null;
    if ("lockTxHash"    in patch) userPatch.lockTxHash    = patch.lockTxHash    ?? null;
    if ("burnTxHash"    in patch) userPatch.burnTxHash    = patch.burnTxHash    ?? null;

    if (userAddress && API && Object.keys(userPatch).length > 0) {
      fetch(`${API}/api/transactions/${tempId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(userPatch),
      }).catch(() => {});
    } else if (!userAddress || !API) {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) {
          const updated = (JSON.parse(raw) as StoredTx[]).map((t) =>
            t.tempId === tempId ? { ...t, ...patch } : t
          );
          localStorage.setItem(LOCAL_KEY, JSON.stringify(updated));
        }
      } catch { /* quota */ }
    }
  }, [userAddress]);

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearHistory = useCallback(() => {
    setTxs([]);

    if (userAddress && API) {
      fetch(`${API}/api/transactions?address=${userAddress}`, { method: "DELETE" }).catch(() => {});
    } else {
      localStorage.removeItem(LOCAL_KEY);
    }
  }, [userAddress]);

  return { txs, addTx, updateTx, clearHistory };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The backend stores "completed" as the terminal status for both directions.
 * Map it to the direction-specific alias ("minted" / "unlocked") so existing
 * UI code (TxStatus component, BridgeForm checks) continue to work unchanged.
 */
function normaliseStatus(tx: StoredTx): StoredTx {
  if (tx.status !== "completed") return tx;
  return { ...tx, status: tx.direction === "forward" ? "minted" : "unlocked" };
}
