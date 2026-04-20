"use client";

import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
  useReadContract,
} from "wagmi";
import { parseUnits, encodePacked, keccak256 } from "viem";
import { sourceChain, destChain, CONTRACT_ADDRESSES, USDC_DECIMALS, DEST_GAS_LIMIT } from "../config/chains";
import BridgeVaultABI  from "../abis/BridgeVault.json";
import ERC20ABI        from "../abis/ERC20.json";
import BridgedUSDCABI  from "../abis/BridgedUSDC.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BridgeStatus =
  | "idle"
  | "approving"
  | "locking"
  | "locked"    // lock confirmed, waiting for relayer to mint
  | "minted"    // relayer confirmed mint on destination
  | "error";

export interface BridgeState {
  status: BridgeStatus;
  approveTxHash: `0x${string}` | null;
  lockTxHash: `0x${string}` | null;
  lockId: `0x${string}` | null;
  error: string | null;
}

export type ReverseBridgeStatus =
  | "idle"
  | "burning"
  | "burned"    // burn confirmed, waiting for relayer to unlock
  | "unlocked"  // relayer confirmed unlock on source
  | "error";

export interface ReverseBridgeState {
  status: ReverseBridgeStatus;
  burnTxHash: `0x${string}` | null;
  burnId: `0x${string}` | null;
  error: string | null;
}

// How long to wait for a tx receipt before giving up (ms).
const RECEIPT_TIMEOUT_MS = 120_000;

// ─── Forward bridge hook (Sepolia → dest) ────────────────────────────────────

export function useBridge() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: sourceChain.id });
  const { data: walletClient } = useWalletClient({ chainId: sourceChain.id });

  const [state, setState] = useState<BridgeState>({
    status:        "idle",
    approveTxHash: null,
    lockTxHash:    null,
    lockId:        null,
    error:         null,
  });

  // Read current USDC balance on source chain.
  const { data: usdcBalance } = useReadContract({
    address:      CONTRACT_ADDRESSES.usdc as `0x${string}`,
    abi:          ERC20ABI,
    functionName: "balanceOf",
    args:         [address ?? "0x0000000000000000000000000000000000000000"],
    chainId:      sourceChain.id,
    query:        { enabled: !!address },
  });

  /**
   * Bridge `humanAmount` USDC from source chain to destination chain.
   * @param humanAmount  Human-readable amount, e.g. "50" for 50 USDC.
   */
  async function bridge(humanAmount: string): Promise<void> {
    if (!address || !walletClient || !publicClient) {
      setState((s) => ({ ...s, status: "error", error: "Wallet not connected" }));
      return;
    }

    const amount = parseUnits(humanAmount, USDC_DECIMALS);

    try {
      // ── Step 1: Approve ──────────────────────────────────────────────────
      setState((s) => ({ ...s, status: "approving", error: null }));

      console.log("[bridge] approve →", {
        usdc:    CONTRACT_ADDRESSES.usdc,
        spender: CONTRACT_ADDRESSES.vault,
        amount:  amount.toString(),
        chain:   sourceChain.id,
        from:    address,
      });

      const approveTxHash = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.usdc as `0x${string}`,
        abi:          ERC20ABI,
        functionName: "approve",
        args:         [CONTRACT_ADDRESSES.vault as `0x${string}`, amount],
        chain:        sourceChain,
        account:      address,
      });

      await publicClient.waitForTransactionReceipt({
        hash:            approveTxHash,
        confirmations:   1,
        pollingInterval: 4_000,
        timeout:         RECEIPT_TIMEOUT_MS,
      });

      setState((s) => ({ ...s, approveTxHash }));

      // ── Step 2: Lock ─────────────────────────────────────────────────────
      setState((s) => ({ ...s, status: "locking" }));

      const currentNonce = await publicClient.readContract({
        address:      CONTRACT_ADDRESSES.vault as `0x${string}`,
        abi:          BridgeVaultABI,
        functionName: "nonce",
      }) as bigint;

      console.log("[bridge] lock →", {
        vault:       CONTRACT_ADDRESSES.vault,
        amount:      amount.toString(),
        destChainId: destChain.id,
        destAddress: address,
        nonce:       currentNonce.toString(),
        chain:       sourceChain.id,
        from:        address,
      });

      const lockTxHash = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.vault as `0x${string}`,
        abi:          BridgeVaultABI,
        functionName: "lock",
        args:         [amount, BigInt(destChain.id), address],
        chain:        sourceChain,
        account:      address,
      });

      await publicClient.waitForTransactionReceipt({
        hash:            lockTxHash,
        confirmations:   1,
        pollingInterval: 4_000,
        timeout:         RECEIPT_TIMEOUT_MS,
      });

      // Derive lockId exactly as the contract does:
      // keccak256(abi.encodePacked(block.chainid, address(this), currentNonce))
      const lockId = keccak256(
        encodePacked(
          ["uint256", "address", "uint256"],
          [BigInt(sourceChain.id), CONTRACT_ADDRESSES.vault as `0x${string}`, currentNonce]
        )
      );

      setState((s) => ({ ...s, status: "locked", lockTxHash, lockId }));
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("Timed out")
        ? `Transaction confirmation timed out. Check your RPC URL (NEXT_PUBLIC_SOURCE_RPC_URL) — it may be unreliable. Raw: ${raw}`
        : raw;
      setState((s) => ({ ...s, status: "error", error: msg }));
    }
  }

  function setMinted() {
    setState((s) => ({ ...s, status: "minted" }));
  }

  function reset() {
    setState({ status: "idle", approveTxHash: null, lockTxHash: null, lockId: null, error: null });
  }

  return {
    bridge,
    reset,
    setMinted,
    state,
    usdcBalance: usdcBalance as bigint | undefined,
  };
}

// ─── Reverse bridge hook (dest → Sepolia) ────────────────────────────────────

export function useReverseBridge() {
  const { address } = useAccount();
  // Burn happens on the destination chain, so we need dest-chain clients.
  const publicClient = usePublicClient({ chainId: destChain.id });
  const { data: walletClient } = useWalletClient({ chainId: destChain.id });

  const [state, setState] = useState<ReverseBridgeState>({
    status:    "idle",
    burnTxHash: null,
    burnId:    null,
    error:     null,
  });

  // Read current bUSDC balance on destination chain.
  const { data: busdcBalance } = useReadContract({
    address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
    abi:          BridgedUSDCABI,
    functionName: "balanceOf",
    args:         [address ?? "0x0000000000000000000000000000000000000000"],
    chainId:      destChain.id,
    query:        { enabled: !!address },
  });

  // Read current burnNonce before burning so we can derive the burnId.
  const { data: burnNonce } = useReadContract({
    address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
    abi:          BridgedUSDCABI,
    functionName: "burnNonce",
    chainId:      destChain.id,
    query:        { enabled: !!address },
  });

  /**
   * Burn `humanAmount` bUSDC on the destination chain to receive USDC on source.
   */
  async function reverseBridge(humanAmount: string): Promise<void> {
    if (!address || !walletClient || !publicClient) {
      setState((s) => ({ ...s, status: "error", error: "Wallet not connected" }));
      return;
    }

    const amount = parseUnits(humanAmount, USDC_DECIMALS);

    try {
      setState((s) => ({ ...s, status: "burning", error: null }));

      // Read the current burnNonce before sending (same race-safety pattern as lockId).
      const currentBurnNonce = burnNonce !== undefined
        ? (burnNonce as bigint)
        : await publicClient.readContract({
            address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
            abi:          BridgedUSDCABI,
            functionName: "burnNonce",
          }) as bigint;

      console.log("[reverseBridge] burn →", {
        bridgedUsdc:  CONTRACT_ADDRESSES.bridgedUsdc,
        amount:       amount.toString(),
        srcChainId:   sourceChain.id,
        destAddress:  address,
        burnNonce:    currentBurnNonce.toString(),
        chain:        destChain.id,
        from:         address,
        walletClient: !!walletClient,
        publicClient: !!publicClient,
      });

      const burnTxHash = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
        abi:          BridgedUSDCABI,
        functionName: "burn",
        args:         [amount, BigInt(sourceChain.id), address],
        chain:        destChain,
        account:      address,
        ...(DEST_GAS_LIMIT !== undefined && { gas: DEST_GAS_LIMIT }),
      });

      await publicClient.waitForTransactionReceipt({
        hash:            burnTxHash,
        confirmations:   1,
        pollingInterval: 2_000, // local chain produces blocks faster
        timeout:         RECEIPT_TIMEOUT_MS,
      });

      // Derive burnId exactly as the contract does:
      // keccak256(abi.encodePacked(block.chainid, address(this), currentBurnNonce))
      const burnId = keccak256(
        encodePacked(
          ["uint256", "address", "uint256"],
          [BigInt(destChain.id), CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`, currentBurnNonce]
        )
      );

      setState((s) => ({ ...s, status: "burned", burnTxHash, burnId }));
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = raw.includes("Timed out")
        ? `Transaction confirmation timed out. Check your RPC URL — it may be unreliable. Raw: ${raw}`
        : raw;
      setState((s) => ({ ...s, status: "error", error: msg }));
    }
  }

  function setUnlocked() {
    setState((s) => ({ ...s, status: "unlocked" }));
  }

  function reset() {
    setState({ status: "idle", burnTxHash: null, burnId: null, error: null });
  }

  return {
    reverseBridge,
    reset,
    setUnlocked,
    state,
    busdcBalance: busdcBalance as bigint | undefined,
  };
}

// ─── Forward bridge — mint confirmation polling ────────────────────────────────

/**
 * Polls BridgedUSDC.processedMints(lockId) on the destination chain every 5 s.
 */
export function useMintConfirmed(lockId: `0x${string}` | null): boolean {
  const { data: isMinted } = useReadContract({
    address:      CONTRACT_ADDRESSES.bridgedUsdc as `0x${string}`,
    abi:          BridgedUSDCABI,
    functionName: "processedMints",
    args:         [lockId ?? "0x0000000000000000000000000000000000000000000000000000000000000000"],
    chainId:      destChain.id,
    query: {
      enabled: !!lockId,
      refetchInterval: (query) => (query.state.data === true ? false : 5_000),
    },
  });

  return isMinted === true;
}

// ─── Reverse bridge — unlock confirmation polling ─────────────────────────────

/**
 * Polls BridgeVault.processedReleases(burnId) on the source chain every 5 s.
 */
export function useUnlockConfirmed(burnId: `0x${string}` | null): boolean {
  const { data: isUnlocked } = useReadContract({
    address:      CONTRACT_ADDRESSES.vault as `0x${string}`,
    abi:          BridgeVaultABI,
    functionName: "processedReleases",
    args:         [burnId ?? "0x0000000000000000000000000000000000000000000000000000000000000000"],
    chainId:      sourceChain.id,
    query: {
      enabled: !!burnId,
      refetchInterval: (query) => (query.state.data === true ? false : 5_000),
    },
  });

  return isUnlocked === true;
}
