"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { formatUnits } from "viem";
import { useBridge, useReverseBridge } from "../hooks/useBridge";
import { useChainSwitch } from "../hooks/useChainSwitch";
import { useTransactionHistory } from "../hooks/useTransactionHistory";
import { TxStatus, ReverseTxStatus } from "./TxStatus";
import { TransactionHistory } from "./TransactionHistory";
import { sourceChain, destChain, USDC_DECIMALS } from "../config/chains";

// ─── Chain logo helper ─────────────────────────────────────────────────────────

function chainLogoSrc(chainName: string): string {
  const lower = chainName.toLowerCase();
  if (lower.includes("bsc") || lower.includes("binance")) return "/binance-logo.png";
  if (lower.includes("amero")) return "/amerox-logo.png";
  return "/amerox-logo.png";
}

// ─── Chain pill ────────────────────────────────────────────────────────────────

function ChainPill({ chainName }: { chainName: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ background: "rgba(212,175,55,0.10)", border: "1px solid rgba(212,175,55,0.22)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={chainLogoSrc(chainName)} alt={chainName} width={18} height={18} style={{ borderRadius: "50%", objectFit: "cover" }} />
      <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "#D4AF37" }}>{chainName}</span>
    </div>
  );
}

// ─── Token pill ────────────────────────────────────────────────────────────────

function TokenPill({ symbol }: { symbol: string }) {
  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 rounded-2xl px-3.5 py-2.5"
      style={{ background: "#1A1200", border: "1px solid rgba(212,175,55,0.25)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/usdc-logo.png" alt="USDC" width={22} height={22} style={{ borderRadius: "50%", objectFit: "cover" }} />
      <span className="font-bold text-sm text-white">{symbol}</span>
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent flex-shrink-0"
      style={{ borderColor: "rgba(0,0,0,0.4)", borderTopColor: "transparent" }}
    />
  );
}

// ─── Main BridgeForm ──────────────────────────────────────────────────────────

export function BridgeForm() {
  const { address, isConnected } = useAccount();

  const [direction, setDirection] = useState<"forward" | "reverse">("forward");
  const { login, logout, authenticated } = usePrivy();
  const { isCorrectChain, isSwitching, switchError, targetChainName, switchToTarget } = useChainSwitch(direction);

  const { bridge, reset: resetForward, setMinted, state: fwdState, usdcBalance } = useBridge();
  const { reverseBridge, reset: resetReverse, setUnlocked, state: revState, busdcBalance } = useReverseBridge();

  const { txs, addTx, updateTx, clearHistory } = useTransactionHistory(address);

  const [amount, setAmount] = useState("");
  const currentTempId = useRef<string | null>(null);

  const formattedUsdcBalance = usdcBalance !== undefined ? formatUnits(usdcBalance, USDC_DECIMALS) : "0";
  const formattedBusdcBalance = busdcBalance !== undefined ? formatUnits(busdcBalance, USDC_DECIMALS) : "0";
  const displayBalance = direction === "forward" ? formattedUsdcBalance : formattedBusdcBalance;

  const usdValue =
    amount && parseFloat(amount) > 0
      ? parseFloat(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "0.00";

  const fwdIsLoading = fwdState.status === "approving" || fwdState.status === "locking";
  const fwdIsWaiting = fwdState.status === "locked";
  const fwdIsDone    = fwdState.status === "minted";
  const fwdIsActive  = fwdState.status !== "idle";

  const revIsLoading = revState.status === "burning";
  const revIsWaiting = revState.status === "burned";
  const revIsDone    = revState.status === "unlocked";
  const revIsActive  = revState.status !== "idle";

  const isLoading   = direction === "forward" ? fwdIsLoading : revIsLoading;
  const isWaiting   = direction === "forward" ? fwdIsWaiting : revIsWaiting;
  const isDone      = direction === "forward" ? fwdIsDone    : revIsDone;
  const isDisabled  = isLoading || isWaiting || isDone;
  const isAnyActive = fwdIsActive || revIsActive;

  // ── Persist forward state to history ──────────────────────────────────────
  useEffect(() => {
    const tempId = currentTempId.current;
    if (!tempId || direction !== "forward") return;
    if (fwdState.status === "locking" || fwdState.status === "locked") {
      updateTx(tempId, {
        approveTxHash: fwdState.approveTxHash,
        lockTxHash:    fwdState.lockTxHash,
        txId:          fwdState.lockId,   // link to the relayer's transactions record
        status:        "pending",
      });
    } else if (fwdState.status === "minted") {
      updateTx(tempId, { lockTxHash: fwdState.lockTxHash, txId: fwdState.lockId, status: "minted" });
      currentTempId.current = null;
    } else if (fwdState.status === "error") {
      updateTx(tempId, { status: "failed", error: fwdState.error });
      currentTempId.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fwdState.status, fwdState.approveTxHash, fwdState.lockTxHash, fwdState.lockId]);

  // ── Persist reverse state to history ──────────────────────────────────────
  useEffect(() => {
    const tempId = currentTempId.current;
    if (!tempId || direction !== "reverse") return;
    if (revState.status === "burned") {
      updateTx(tempId, { burnTxHash: revState.burnTxHash, txId: revState.burnId, status: "pending" });
    } else if (revState.status === "unlocked") {
      updateTx(tempId, { burnTxHash: revState.burnTxHash, txId: revState.burnId, status: "unlocked" });
      currentTempId.current = null;
    } else if (revState.status === "error") {
      updateTx(tempId, { status: "failed", error: revState.error });
      currentTempId.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revState.status, revState.burnTxHash, revState.burnId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    const tempId = `tx-${Date.now()}`;
    currentTempId.current = tempId;
    if (direction === "forward") {
      addTx({
        id: tempId, tempId, timestamp: Date.now(), amount,
        direction: "forward", status: "pending",
        approveTxHash: null, lockTxHash: null, txId: null,
        burnTxHash: null, mintTxHash: null, unlockTxHash: null,
        sourceChain: sourceChain.name, destChain: destChain.name, error: null,
      });
      await bridge(amount);
    } else {
      addTx({
        id: tempId, tempId, timestamp: Date.now(), amount,
        direction: "reverse", status: "pending",
        approveTxHash: null, lockTxHash: null, txId: null,
        burnTxHash: null, mintTxHash: null, unlockTxHash: null,
        sourceChain: sourceChain.name, destChain: destChain.name, error: null,
      });
      await reverseBridge(amount);
    }
  }

  const handleMinted   = useCallback(() => setMinted(),   [setMinted]);
  const handleUnlocked = useCallback(() => setUnlocked(), [setUnlocked]);

  function handleReset() {
    setAmount("");
    resetForward();
    resetReverse();
    currentTempId.current = null;
  }

  function handleSwapDirection() {
    if (isAnyActive) return;
    setDirection((d) => (d === "forward" ? "reverse" : "forward"));
    setAmount("");
    resetForward();
    resetReverse();
    currentTempId.current = null;
  }

  const fromChainName     = direction === "forward" ? sourceChain.name : destChain.name;
  const toChainName       = direction === "forward" ? destChain.name   : sourceChain.name;
  const fromSymbol        = direction === "forward" ? "USDC"  : "bUSDC";
  const toSymbol          = direction === "forward" ? "bUSDC" : "USDC";
  const hasAmount         = !!amount && parseFloat(amount) > 0;
  const hasBalance        = parseFloat(displayBalance) > 0;
  const exceedsBalance    = isConnected && hasAmount && parseFloat(amount) > parseFloat(displayBalance);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ── Bridge card ── */}
      <div
        className="w-full rounded-3xl overflow-hidden"
        style={{
          background: "#111111",
          border: "1px solid rgba(212,175,55,0.22)",
          boxShadow: "0 0 40px rgba(212,175,55,0.08), 0 20px 60px rgba(0,0,0,0.6)",
        }}
      >

        {/* Card header */}
        <div
          className="flex items-center justify-between px-6 pt-6 pb-5"
          style={{ borderBottom: "1px solid rgba(212,175,55,0.12)" }}
        >
          <div>
            <h2 className="text-xl font-bold text-white">Bridge</h2>
            <p className="text-xs mt-0.5" style={{ color: "rgba(212,175,55,0.5)" }}>1 USDC = 1 bUSDC · No fees</p>
          </div>
          {authenticated && address ? (
            <button
              type="button"
              onClick={logout}
              className="text-xs font-semibold px-3 py-2 rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "rgba(212,175,55,0.10)", border: "1px solid rgba(212,175,55,0.22)", color: "#D4AF37" }}
            >
              {address.slice(0, 6)}…{address.slice(-4)}
            </button>
          ) : (
            <button
              type="button"
              onClick={login}
              className="text-xs font-semibold px-3 py-2 rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)", color: "#000000" }}
            >
              Connect
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── FROM section ── */}
          <div className="px-6 pt-5 pb-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(212,175,55,0.5)" }}>From</span>
              <ChainPill chainName={fromChainName} />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                {isDisabled ? (
                  <div className="text-5xl font-bold text-white leading-none">{amount || "0"}</div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!isConnected || !isCorrectChain}
                    className={`text-5xl font-bold bg-transparent outline-none w-full leading-none disabled:cursor-not-allowed transition-colors ${
                      exceedsBalance ? "text-red-400" : "text-white"
                    }`}
                    style={{ caretColor: "#D4AF37" }}
                  />
                )}
                <p className={`text-sm mt-2 transition-colors ${exceedsBalance ? "text-red-400" : ""}`}
                   style={exceedsBalance ? {} : { color: "rgba(212,175,55,0.45)" }}>
                  ${usdValue}
                </p>
              </div>
              <TokenPill symbol={fromSymbol} />
            </div>

            {isConnected && !isDisabled && (
              <div className="mt-3 flex items-center justify-between">
                {exceedsBalance ? (
                  <div className="flex items-center gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6.5" stroke="#f87171" strokeWidth="1.2" />
                      <path d="M7 4v3.5" stroke="#f87171" strokeWidth="1.4" strokeLinecap="round" />
                      <circle cx="7" cy="10" r="0.7" fill="#f87171" />
                    </svg>
                    <span className="text-xs font-semibold text-red-400">
                      Insufficient balance — you only have {parseFloat(displayBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {fromSymbol}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Balance: {parseFloat(displayBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })} {fromSymbol}
                    </span>
                    {hasBalance && (
                      <button
                        type="button"
                        onClick={() => setAmount(displayBalance)}
                        className="text-xs font-bold px-2 py-0.5 rounded-full transition-opacity hover:opacity-80"
                        style={{ background: "rgba(212,175,55,0.15)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.3)" }}
                      >
                        Max
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Swap button divider ── */}
          <div className="relative flex items-center justify-center py-0 px-6">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px" style={{ background: "rgba(212,175,55,0.12)" }} />
            <button
              type="button"
              onClick={handleSwapDirection}
              disabled={isAnyActive}
              title="Swap direction"
              className="relative z-10 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#1A1200", border: "2px solid rgba(212,175,55,0.35)" }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4-4 4 4M12 10l-4 4-4-4" stroke="#D4AF37" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* ── TO section ── */}
          <div className="px-6 pt-5 pb-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(212,175,55,0.5)" }}>To</span>
              <ChainPill chainName={toChainName} />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-5xl font-bold leading-none" style={{ color: "rgba(255,255,255,0.2)" }}>{amount || "0"}</div>
                <p className="text-sm mt-2" style={{ color: "rgba(212,175,55,0.35)" }}>${usdValue}</p>
              </div>
              <TokenPill symbol={toSymbol} />
            </div>
          </div>

          {/* ── Details row (when amount entered) ── */}
          {hasAmount && (
            <div
              className="mx-6 mb-2 flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: "rgba(212,175,55,0.05)", border: "1px solid rgba(212,175,55,0.12)" }}
            >
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                1 {fromSymbol} = 1 {toSymbol}
              </span>
              <span className="text-xs flex items-center gap-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5" stroke="rgba(212,175,55,0.5)" strokeWidth="1.2" />
                  <path d="M6 3.5v3l1.5 1.5" stroke="rgba(212,175,55,0.5)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                ~15 min
              </span>
            </div>
          )}

          {/* ── Transaction status ── */}
          {(fwdIsActive || revIsActive) && (
            <div className="px-6 pb-2">
              {direction === "forward"
                ? <TxStatus state={fwdState} onMinted={handleMinted} />
                : <ReverseTxStatus state={revState} onUnlocked={handleUnlocked} />
              }
            </div>
          )}

          {/* ── CTA button ── */}
          <div className="px-6 pb-6 pt-3 flex flex-col gap-3">
            {!isConnected ? (
              <button
                type="button"
                onClick={login}
                className="w-full py-4 rounded-2xl font-bold text-sm transition-opacity"
                style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)", color: "#000000" }}
              >
                Connect Wallet
              </button>
            ) : !isCorrectChain ? (
              <>
                <button
                  type="button"
                  onClick={switchToTarget}
                  disabled={isSwitching}
                  className="w-full py-4 rounded-2xl font-bold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)", color: "#000000" }}
                >
                  {isSwitching ? <><Spinner /> Switching…</> : `Switch to ${targetChainName}`}
                </button>
                {switchError && (
                  <p className="text-xs text-red-400 text-center">{switchError.message}</p>
                )}
              </>
            ) : isDone ? (
              <button
                type="button"
                onClick={handleReset}
                className="w-full py-4 rounded-2xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #14532d, #16a34a)", color: "#ffffff" }}
              >
                ✓ Bridge complete — Do another
              </button>
            ) : isWaiting ? (
              <button
                type="button"
                disabled
                className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 opacity-70"
                style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)", color: "#000000" }}
              >
                <Spinner /> Waiting for relayer…
              </button>
            ) : exceedsBalance ? (
              <button
                type="button"
                disabled
                className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 cursor-not-allowed"
                style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="#f87171" strokeWidth="1.5"/>
                  <path d="M8 4.5v4" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="8" cy="11" r="0.8" fill="#f87171"/>
                </svg>
                Insufficient Balance
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading || !hasAmount}
                className="w-full py-4 rounded-2xl font-bold text-sm transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #B8860B, #FFD700)", color: "#000000" }}
              >
                {isLoading ? (
                  direction === "forward"
                    ? <><Spinner /> {fwdState.status === "approving" ? "Approving…" : "Locking…"}</>
                    : <><Spinner /> Burning…</>
                ) : hasAmount ? (
                  `Bridge ${amount} ${fromSymbol}`
                ) : (
                  "Enter an amount"
                )}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Transaction history (below card) ── */}
      <TransactionHistory txs={txs} onUpdate={updateTx} onClear={clearHistory} />
    </div>
  );
}
