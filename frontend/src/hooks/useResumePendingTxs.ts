"use client";

import { useEffect, useRef, useMemo } from "react";
import { usePublicClient } from "wagmi";
import { sourceChain, destChain, CONTRACT_ADDRESSES } from "../config/chains";
import { StoredTx } from "./useTransactionHistory";
import BridgeVaultABI  from "../abis/BridgeVault.json";
import BridgedUSDCABI  from "../abis/BridgedUSDC.json";

const POLL_INTERVAL_MS = 5_000;

/**
 * On mount, finds every "pending" tx that has a txId (lockId or burnId),
 * then polls the chain every 5 s until the relayer confirms it.
 * Covers the case where the user closes the tab mid-bridge and comes back.
 */
export function useResumePendingTxs(
  txs: StoredTx[],
  updateTx: (tempId: string, patch: Partial<StoredTx>) => void
) {
  const sourceClient = usePublicClient({ chainId: sourceChain.id });
  const destClient   = usePublicClient({ chainId: destChain.id });

  // Keep a stable ref so the interval always sees the latest txs list
  // without restarting every time txs changes.
  const txsRef = useRef(txs);
  txsRef.current = txs;

  // Stable string that only changes when the set of pollable tx IDs changes.
  const pollableKey = useMemo(
    () =>
      txs
        .filter((tx) => tx.status === "pending" && tx.txId)
        .map((tx) => tx.tempId)
        .join(","),
    [txs]
  );

  useEffect(() => {
    if (!pollableKey) return; // nothing to poll

    async function checkAll() {
      const pending = txsRef.current.filter(
        (tx) => tx.status === "pending" && tx.txId
      );

      for (const tx of pending) {
        try {
          if (tx.direction === "forward" && tx.txId && destClient) {
            // txId == lockId for forward bridge
            const minted = await destClient.readContract({
              address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
              abi:          BridgedUSDCABI,
              functionName: "processedMints",
              args:         [tx.txId as `0x${string}`],
            });
            if (minted) {
              console.log(`[Resume] forward tx ${tx.tempId} confirmed — updating to minted`);
              updateTx(tx.tempId, { status: "minted" });
            }
          } else if (tx.direction === "reverse" && tx.txId && sourceClient) {
            // txId == burnId for reverse bridge
            const unlocked = await sourceClient.readContract({
              address:      CONTRACT_ADDRESSES.vault as `0x${string}`,
              abi:          BridgeVaultABI,
              functionName: "processedReleases",
              args:         [tx.txId as `0x${string}`],
            });
            if (unlocked) {
              console.log(`[Resume] reverse tx ${tx.tempId} confirmed — updating to unlocked`);
              updateTx(tx.tempId, { status: "unlocked" });
            }
          }
        } catch {
          // Ignore individual poll errors — will retry on next interval tick.
        }
      }
    }

    // Check immediately so the user sees the update as soon as they open the page.
    void checkAll();
    const id = setInterval(() => void checkAll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollableKey, sourceClient, destClient]);
}
