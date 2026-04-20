"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "bridge_tx_history";
const MAX_TXS     = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TxStatus = "pending" | "minted" | "unlocked" | "failed";

export interface StoredTx {
  id:             string;             // stable ID for updates
  tempId:         string;             // always set — used to find the row before lockId/burnId is known
  timestamp:      number;             // ms since epoch
  amount:         string;             // human-readable, e.g. "50"
  direction:      "forward" | "reverse";
  status:         TxStatus;
  // Forward bridge fields
  approveTxHash:  string | null;
  lockTxHash:     string | null;
  lockId:         string | null;
  // Reverse bridge fields
  burnTxHash:     string | null;
  burnId:         string | null;
  // Chain labels
  sourceChain:    string;
  destChain:      string;
  error:          string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTransactionHistory() {
  const [txs, setTxs] = useState<StoredTx[]>([]);

  // Hydrate from localStorage once on mount (client-only).
  // Filter out failed txs — they are session-only and should not survive a reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredTx[];
        const withoutFailed = parsed.filter((t) => t.status !== "failed");
        setTxs(withoutFailed);
        // Rewrite localStorage without the failed txs so they're gone for good.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutFailed));
      }
    } catch {
      // Ignore corrupted data.
    }
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const persist = useCallback((updated: StoredTx[]) => {
    const trimmed = updated.slice(0, MAX_TXS);
    // Always keep all txs in React state (failed ones visible in current session).
    setTxs(trimmed);
    // Only persist non-failed txs — failed ones disappear on page reload.
    const toStore = trimmed.filter((t) => t.status !== "failed");
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore)); } catch { /* quota */ }
  }, []);

  const addTx = useCallback((tx: StoredTx) => {
    persist([tx, ...txs]);
  }, [txs, persist]);

  const updateTx = useCallback((tempId: string, patch: Partial<StoredTx>) => {
    const updated = txs.map((t) => t.tempId === tempId ? { ...t, ...patch } : t);
    persist(updated);
  }, [txs, persist]);

  const clearHistory = useCallback(() => {
    persist([]);
  }, [persist]);

  return { txs, addTx, updateTx, clearHistory };
}
