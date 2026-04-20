"use client";

import { useEffect } from "react";
import {
  BridgeState,
  ReverseBridgeState,
  useMintConfirmed,
  useUnlockConfirmed,
} from "../hooks/useBridge";
import { sourceChain, destChain } from "../config/chains";

// ─── Forward bridge status panel ──────────────────────────────────────────────

interface ForwardProps {
  state: BridgeState;
  onMinted: () => void;
}

export function TxStatus({ state, onMinted }: ForwardProps) {
  const isMinted = useMintConfirmed(state.lockId);

  useEffect(() => {
    if (isMinted && state.status === "locked") onMinted();
  }, [isMinted, state.status, onMinted]);

  if (state.status === "idle") return null;

  const effectiveStatus =
    state.status === "locked" && isMinted ? "minted" : state.status;

  return (
    <div
      className="rounded-2xl px-5 py-4 text-sm space-y-3"
      style={{ background: "rgba(212,175,55,0.05)", border: "1px solid rgba(212,175,55,0.15)" }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={effectiveStatus} />
        <span className="font-semibold text-white">
          {FORWARD_HEADER[effectiveStatus] ?? FORWARD_HEADER[state.status]}
        </span>
      </div>

      <div className="space-y-2 pl-1">
        <Step
          done={["locking", "locked", "minted"].includes(state.status)}
          active={state.status === "approving"}
          label="Approve USDC"
          txHash={state.approveTxHash}
          explorerUrl={sourceChain.blockExplorers?.default.url}
        />
        <Step
          done={["locked", "minted"].includes(state.status)}
          active={state.status === "locking"}
          label={`Lock USDC on ${sourceChain.name}`}
          txHash={state.lockTxHash}
          explorerUrl={sourceChain.blockExplorers?.default.url}
        />
        <Step
          done={isMinted || state.status === "minted"}
          active={state.status === "locked" && !isMinted}
          label={`Relayer mints bUSDC on ${destChain.name}`}
        />
      </div>

      {state.lockId && (
        <p className="text-[10px] font-mono break-all" style={{ color: "rgba(212,175,55,0.3)" }}>{state.lockId}</p>
      )}

      {state.status === "error" && state.error && (
        <p className="text-red-400 text-xs break-words">{state.error}</p>
      )}
    </div>
  );
}

// ─── Reverse bridge status panel ──────────────────────────────────────────────

interface ReverseProps {
  state: ReverseBridgeState;
  onUnlocked: () => void;
}

export function ReverseTxStatus({ state, onUnlocked }: ReverseProps) {
  const isUnlocked = useUnlockConfirmed(state.burnId);

  useEffect(() => {
    if (isUnlocked && state.status === "burned") onUnlocked();
  }, [isUnlocked, state.status, onUnlocked]);

  if (state.status === "idle") return null;

  const effectiveStatus =
    state.status === "burned" && isUnlocked ? "unlocked" : state.status;

  return (
    <div
      className="rounded-2xl px-5 py-4 text-sm space-y-3"
      style={{ background: "rgba(212,175,55,0.05)", border: "1px solid rgba(212,175,55,0.15)" }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={effectiveStatus} />
        <span className="font-semibold text-white">
          {REVERSE_HEADER[effectiveStatus] ?? REVERSE_HEADER[state.status]}
        </span>
      </div>

      <div className="space-y-2 pl-1">
        <Step
          done={["burned", "unlocked"].includes(state.status)}
          active={state.status === "burning"}
          label={`Burn bUSDC on ${destChain.name}`}
          txHash={state.burnTxHash}
          explorerUrl={destChain.blockExplorers?.default.url}
        />
        <Step
          done={isUnlocked || state.status === "unlocked"}
          active={state.status === "burned" && !isUnlocked}
          label={`Relayer releases USDC on ${sourceChain.name}`}
        />
      </div>

      {state.burnId && (
        <p className="text-[10px] font-mono break-all" style={{ color: "rgba(212,175,55,0.3)" }}>{state.burnId}</p>
      )}

      {state.status === "error" && state.error && (
        <p className="text-red-400 text-xs break-words">{state.error}</p>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FORWARD_HEADER: Record<string, string> = {
  approving: "Approving USDC…",
  locking:   "Locking USDC…",
  locked:    "Waiting for relayer…",
  minted:    "Bridge complete!",
  error:     "Transaction failed",
};

const REVERSE_HEADER: Record<string, string> = {
  burning:  "Burning bUSDC…",
  burned:   "Waiting for relayer…",
  unlocked: "Bridge complete!",
  error:    "Transaction failed",
};

function StatusDot({ status }: { status: string }) {
  if (status === "minted" || status === "unlocked")
    return <span className="text-green-400 text-base leading-none">✓</span>;
  if (status === "error")
    return <span className="text-red-400 text-base leading-none">✗</span>;
  return (
    <span
      className="inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2"
      style={{ borderColor: "rgba(212,175,55,0.4)", borderTopColor: "#D4AF37" }}
    />
  );
}

function Step({
  done, active, label, txHash, explorerUrl,
}: {
  done: boolean; active: boolean; label: string;
  txHash?: `0x${string}` | null; explorerUrl?: string;
}) {
  const color = done
    ? "#4ade80"
    : active
    ? "#D4AF37"
    : "rgba(255,255,255,0.2)";

  return (
    <div className="flex items-center gap-2.5" style={{ color }}>
      <span className="w-4 text-center text-xs select-none">
        {done ? "✓" : active ? "›" : "○"}
      </span>
      <span className="text-xs" style={{ fontWeight: active ? 500 : 400 }}>{label}</span>
      {txHash && explorerUrl && (
        <a
          href={`${explorerUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[10px] underline shrink-0"
          style={{ color: "#D4AF37" }}
        >
          view tx ↗
        </a>
      )}
    </div>
  );
}
