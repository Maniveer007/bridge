"use client";

import { StoredTx } from "../hooks/useTransactionHistory";
import { sourceChain, destChain } from "../config/chains";

interface Props {
  txs: StoredTx[];
  onClear: () => void;
}

export function TransactionHistory({ txs, onClear }: Props) {
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
          <TxCard key={tx.tempId} tx={tx} />
        ))}
      </div>
    </div>
  );
}

function TxCard({ tx }: { tx: StoredTx }) {
  const isReverse    = tx.direction === "reverse";
  const explorerUrl  = isReverse
    ? destChain.blockExplorers?.default.url
    : sourceChain.blockExplorers?.default.url;

  const fromSymbol = isReverse ? "bUSDC" : "USDC";
  const toSymbol   = isReverse ? "USDC"  : "bUSDC";
  const fromChain  = isReverse ? tx.destChain   : tx.sourceChain;
  const toChain    = isReverse ? tx.sourceChain : tx.destChain;

  const primaryTxHash = isReverse ? tx.burnTxHash   : tx.lockTxHash;
  const primaryLabel  = isReverse ? "Burn tx ↗"     : "Lock tx ↗";
  const secondaryHash = isReverse ? null             : tx.approveTxHash;

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
        <StatusBadge status={tx.status} />
      </div>

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
          {secondaryHash && explorerUrl && (
            <a
              href={`${explorerUrl}/tx/${secondaryHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] underline"
              style={{ color: "rgba(212,175,55,0.5)" }}
            >
              Approve ↗
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

function StatusBadge({ status }: { status: StoredTx["status"] }) {
  const styles: Record<StoredTx["status"], { bg: string; text: string; label: string }> = {
    pending:  { bg: "rgba(212,175,55,0.12)", text: "#D4AF37",  label: "Pending"  },
    minted:   { bg: "rgba(34,197,94,0.12)",  text: "#4ade80",  label: "Minted"   },
    unlocked: { bg: "rgba(34,197,94,0.12)",  text: "#4ade80",  label: "Unlocked" },
    failed:   { bg: "rgba(239,68,68,0.12)",  text: "#f87171",  label: "Failed"   },
  };
  const s = styles[status];
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: s.bg, color: s.text }}
    >
      {status === "pending" && (
        <span className="inline-block h-2 w-2 mr-1 animate-pulse rounded-full" style={{ background: "#D4AF37" }} />
      )}
      {s.label}
    </span>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s    = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
