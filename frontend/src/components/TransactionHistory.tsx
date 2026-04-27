"use client";

import { useEffect } from "react";
import { useReadContract } from "wagmi";
import { StoredTx } from "../hooks/useTransactionHistory";
import { sourceChain, destChain, CONTRACT_ADDRESSES } from "../config/chains";
import BridgeVaultABI  from "../abis/BridgeVault.json";
import BridgedUSDCABI  from "../abis/BridgedUSDC.json";

interface Props {
  txs: StoredTx[];
  onUpdate: (tempId: string, patch: Partial<StoredTx>) => void;
  onClear: () => void;
}

export function TransactionHistory({ txs, onUpdate, onClear }: Props) {
  if (txs.length === 0) return null;

  return (
    <div className="w-full mt-2">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold" style={{ color: "rgba(212,175,55,0.6)" }}>Recent transactions</h2>
        <button
          onClick={onClear}
          className="text-xs transition-colors hover:opacity-80"
          style={{ color: "rgba(212,175,55,0.3)" }}
        >
          Clear all
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {txs.map((tx) => (
          <TxCard key={tx.tempId} tx={tx} onUpdate={(patch) => onUpdate(tx.tempId, patch)} />
        ))}
      </div>
    </div>
  );
}

// ─── TxCard: self-polls chain for every pending tx ────────────────────────────

function TxCard({ tx, onUpdate }: { tx: StoredTx; onUpdate: (patch: Partial<StoredTx>) => void }) {
  // txId == lockId for forward bridge, burnId for reverse bridge
  const isPendingForward = tx.status === "pending" && tx.direction === "forward" && !!tx.txId;
  const isPendingReverse = tx.status === "pending" && tx.direction === "reverse" && !!tx.txId;

  // ── Poll dest chain for mint confirmation ──────────────────────────────────
  const { data: isMinted, isFetching: checkingMint } = useReadContract({
    address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
    abi:          BridgedUSDCABI,
    functionName: "processedMints",
    args:         [tx.txId ?? "0x0000000000000000000000000000000000000000000000000000000000000000"],
    chainId:      destChain.id,
    query: {
      enabled:         isPendingForward,
      refetchInterval: (q) => (q.state.data === true ? false : 5_000),
    },
  });

  // ── Poll source chain for unlock confirmation ──────────────────────────────
  const { data: isUnlocked, isFetching: checkingUnlock } = useReadContract({
    address:      CONTRACT_ADDRESSES.vault as `0x${string}`,
    abi:          BridgeVaultABI,
    functionName: "processedReleases",
    args:         [tx.txId ?? "0x0000000000000000000000000000000000000000000000000000000000000000"],
    chainId:      sourceChain.id,
    query: {
      enabled:         isPendingReverse,
      refetchInterval: (q) => (q.state.data === true ? false : 5_000),
    },
  });

  // ── Persist confirmed status ───────────────────────────────────────────────
  useEffect(() => {
    if (isMinted === true && tx.status === "pending") {
      onUpdate({ status: "minted" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMinted]);

  useEffect(() => {
    if (isUnlocked === true && tx.status === "pending") {
      onUpdate({ status: "unlocked" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnlocked]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const isReverse   = tx.direction === "reverse";
  const explorerUrl = isReverse
    ? destChain.blockExplorers?.default.url
    : sourceChain.blockExplorers?.default.url;
  const relayerExplorerUrl = isReverse
    ? sourceChain.blockExplorers?.default.url   // relayer unlocks on source
    : destChain.blockExplorers?.default.url;    // relayer mints on dest

  const fromSymbol = isReverse ? "bUSDC" : "USDC";
  const toSymbol   = isReverse ? "USDC"  : "bUSDC";
  const fromChain  = isReverse ? tx.destChain   : tx.sourceChain;
  const toChain    = isReverse ? tx.sourceChain : tx.destChain;

  const primaryTxHash  = isReverse ? tx.burnTxHash   : tx.lockTxHash;
  const primaryLabel   = isReverse ? "Burn tx ↗"     : "Lock tx ↗";
  const relayerTxHash  = isReverse ? tx.unlockTxHash : tx.mintTxHash;
  const relayerLabel   = isReverse ? "Unlock tx ↗"   : "Mint tx ↗";

  const isChecking      = (isPendingForward && checkingMint) || (isPendingReverse && checkingUnlock);
  const isWatchingChain = isPendingForward || isPendingReverse;

  return (
    <div
      className="rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: "#111111", border: "1px solid rgba(212,175,55,0.18)" }}
    >
      {/* Top: amount + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: isReverse ? "rgba(212,175,55,0.15)" : "rgba(212,175,55,0.2)", border: "1px solid rgba(212,175,55,0.35)" }}
          >
            <span className="text-xs font-bold" style={{ color: "#D4AF37" }}>
              {isReverse ? "↩" : "$"}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-white">
              {tx.amount} {fromSymbol}
              <span className="font-normal" style={{ color: "rgba(255,255,255,0.35)" }}> → {tx.amount} {toSymbol}</span>
            </p>
            <p className="text-[11px]" style={{ color: "rgba(212,175,55,0.4)" }}>
              {fromChain} → {toChain}
            </p>
          </div>
        </div>
        <StatusBadge status={tx.status} isChecking={isChecking} isWatchingChain={isWatchingChain} />
      </div>

      {/* Watching chain banner */}
      {isWatchingChain && tx.status === "pending" && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-1.5"
          style={{ background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.15)" }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full animate-spin border-2 flex-shrink-0"
            style={{ borderColor: "rgba(212,175,55,0.3)", borderTopColor: "#D4AF37" }}
          />
          <span className="text-[11px]" style={{ color: "rgba(212,175,55,0.7)" }}>
            Watching chain for relayer confirmation…
          </span>
        </div>
      )}

      {/* Bottom: tx links + time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {primaryTxHash && explorerUrl && (
            <a
              href={`${explorerUrl}/tx/${primaryTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline"
              style={{ color: "#D4AF37" }}
            >
              {primaryLabel}
            </a>
          )}
          {tx.approveTxHash && explorerUrl && (
            <a
              href={`${explorerUrl}/tx/${tx.approveTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline"
              style={{ color: "rgba(212,175,55,0.5)" }}
            >
              Approve ↗
            </a>
          )}
          {relayerTxHash && relayerExplorerUrl && (
            <a
              href={`${relayerExplorerUrl}/tx/${relayerTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline"
              style={{ color: "rgba(34,197,94,0.7)" }}
            >
              {relayerLabel}
            </a>
          )}
        </div>
        <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>{timeAgo(tx.timestamp)}</span>
      </div>

      {/* Error message */}
      {tx.status === "failed" && tx.error && (
        <p className="text-[11px] text-red-400 break-words">{tx.error}</p>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type BadgeStyle = { bg: string; text: string; label: string };

const STATUS_STYLES: Record<string, BadgeStyle> = {
  pending:   { bg: "rgba(212,175,55,0.12)", text: "#D4AF37",  label: "Pending"   },
  minted:    { bg: "rgba(34,197,94,0.12)",  text: "#4ade80",  label: "Minted"    },
  unlocked:  { bg: "rgba(34,197,94,0.12)",  text: "#4ade80",  label: "Unlocked"  },
  completed: { bg: "rgba(34,197,94,0.12)",  text: "#4ade80",  label: "Completed" },
  failed:    { bg: "rgba(239,68,68,0.12)",  text: "#f87171",  label: "Failed"    },
};

const FALLBACK_STYLE: BadgeStyle = { bg: "rgba(255,255,255,0.08)", text: "#aaa", label: "Unknown" };

function StatusBadge({
  status,
  isChecking,
  isWatchingChain,
}: {
  status: StoredTx["status"];
  isChecking: boolean;
  isWatchingChain: boolean;
}) {
  const s = STATUS_STYLES[status] ?? FALLBACK_STYLE;
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1"
      style={{ background: s.bg, color: s.text }}
    >
      {status === "pending" && isWatchingChain ? (
        <span
          className="inline-block h-2 w-2 rounded-full animate-spin border border-current"
          style={{ borderTopColor: "transparent" }}
        />
      ) : status === "pending" ? (
        <span className="inline-block h-2 w-2 mr-0.5 animate-pulse rounded-full" style={{ background: "#D4AF37" }} />
      ) : null}
      {s.label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s    = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
