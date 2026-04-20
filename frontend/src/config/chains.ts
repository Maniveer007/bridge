import { defineChain, http, fallback, custom } from "viem";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

// ─── RPC URLs ────────────────────────────────────────────────────────────────

const SOURCE_RPC    = process.env.NEXT_PUBLIC_SOURCE_RPC_URL        ?? "https://ethereum-sepolia-rpc.publicnode.com";
const SOURCE_BACKUP = process.env.NEXT_PUBLIC_SOURCE_BACKUP_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const DEST_RPC      = process.env.NEXT_PUBLIC_DEST_RPC_URL          ?? "http://127.0.0.1:8545";
const DEST_BACKUP   = process.env.NEXT_PUBLIC_DEST_BACKUP_RPC_URL   ?? DEST_RPC;

// Pre-London legacy tx flags — must be declared before chain definitions.
export const SOURCE_LEGACY_TX = (process.env.NEXT_PUBLIC_SOURCE_LEGACY_TX ?? "false").toLowerCase() === "true";
export const DEST_LEGACY_TX   = (process.env.NEXT_PUBLIC_DEST_LEGACY_TX   ?? "false").toLowerCase() === "true";

// Optional explicit gas limit for the destination chain (useful for chains that
// don't support EIP-1559 gas estimation). Only applied to burn transactions.
export const DEST_GAS_LIMIT: bigint | undefined = process.env.NEXT_PUBLIC_DEST_GAS_LIMIT
  ? BigInt(process.env.NEXT_PUBLIC_DEST_GAS_LIMIT)
  : undefined;

// ─── Legacy transport ─────────────────────────────────────────────────────────
// Wraps a plain fetch-based JSON-RPC transport and strips `baseFeePerGas` from
// every block response. This makes viem (and MetaMask) believe the chain is
// pre-London, so they always build type-0 (legacy) transactions — no EIP-1559.

function legacyTransport(url: string) {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }),
      });
      const { result, error } = await res.json();
      if (error) throw new Error(error.message ?? "RPC error");

      // Strip baseFeePerGas from block objects → forces pre-London detection
      if (result && typeof result === "object" &&
          (method === "eth_getBlockByNumber" || method === "eth_getBlockByHash")) {
        delete result.baseFeePerGas;
      }
      return result;
    },
  });
}

// ─── Chain definitions ────────────────────────────────────────────────────────

export const sourceChain = defineChain({
  id:   parseInt(process.env.NEXT_PUBLIC_SOURCE_CHAIN_ID ?? "11155111", 10),
  name: process.env.NEXT_PUBLIC_SOURCE_CHAIN_NAME ?? "Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [SOURCE_RPC] },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url:  process.env.NEXT_PUBLIC_SOURCE_EXPLORER ?? "https://sepolia.etherscan.io",
    },
  },
});

export const destChain = defineChain({
  id:   parseInt(process.env.NEXT_PUBLIC_DEST_CHAIN_ID ?? "31337", 10),
  name: process.env.NEXT_PUBLIC_DEST_CHAIN_NAME ?? "Local Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [DEST_RPC] },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: process.env.NEXT_PUBLIC_DEST_EXPLORER ?? "http://localhost",
    },
  },
});

// ─── Contract addresses ───────────────────────────────────────────────────────

export const CONTRACT_ADDRESSES = {
  vault:       process.env.NEXT_PUBLIC_VAULT_ADDRESS        ?? "",
  usdc:        process.env.NEXT_PUBLIC_USDC_ADDRESS         ?? "",
  bridgedUsdc: process.env.NEXT_PUBLIC_BRIDGED_USDC_ADDRESS ?? "",
} as const;

// ─── Token decimals ───────────────────────────────────────────────────────────

export const USDC_DECIMALS: number = parseInt(
  process.env.NEXT_PUBLIC_USDC_DECIMALS ?? "6",
  10
);

// ─── Wagmi + RainbowKit config ────────────────────────────────────────────────
// For legacy chains, use legacyTransport (strips baseFeePerGas from blocks).
// For normal chains, use the standard http transport with fallback.

const sourceTransport = SOURCE_LEGACY_TX
  ? legacyTransport(SOURCE_RPC)
  : fallback([
      http(SOURCE_RPC,    { retryCount: 2, retryDelay: 500 }),
      http(SOURCE_BACKUP, { retryCount: 3, retryDelay: 500 }),
    ]);

const destTransport = DEST_LEGACY_TX
  ? legacyTransport(DEST_RPC)
  : fallback([
      http(DEST_RPC,    { retryCount: 2, retryDelay: 500 }),
      http(DEST_BACKUP, { retryCount: 3, retryDelay: 500 }),
    ]);

export const wagmiConfig = getDefaultConfig({
  appName:   "USDC Bridge",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "b56e18d47c72ab683b10814fe9495694",
  chains:    [sourceChain, destChain] as any,
  ssr:       true,
  transports: {
    [sourceChain.id]: sourceTransport,
    [destChain.id]:   destTransport,
  },
});
