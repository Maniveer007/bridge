import { ethers } from "ethers";
import { getLastBlock, getDestLastBlock } from "./store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  provider: ethers.JsonRpcProvider;
}

export interface BridgeConfig {
  source: ChainConfig & {
    vaultAddress: string;
    usdcAddress: string;
    confirmations: number;
    startBlock: number;
  };
  destination: ChainConfig & {
    bridgedUsdcAddress: string;
    startBlock: number;
  };
  usdcDecimals: number;
  relayerKey: string;
  pollIntervalMs: number;
  syncBatchSize: number;
  batchDelayMs: number;
  lookbackBlocks: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function optionalEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`[Config] ${key} must be an integer, got: ${raw}`);
  return parsed;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<BridgeConfig> {
  const sourceRpc = requireEnv("SOURCE_RPC_URL");
  const destRpc   = requireEnv("DEST_RPC_URL");

  // Block-cursor priority:
  //   1. MongoDB cursor — resume exactly where we left off after a crash
  //   2. env START_BLOCK — first run, or after --fresh
  const [dbLastBlock, dbDestLastBlock] = await Promise.all([
    getLastBlock(),
    getDestLastBlock(),
  ]);

  const forwardStart = Math.max(optionalEnvInt("START_BLOCK",      0), dbLastBlock);
  const reverseStart = Math.max(optionalEnvInt("DEST_START_BLOCK", 0), dbDestLastBlock);

  return {
    source: {
      name:          process.env.SOURCE_CHAIN_NAME ?? "Sepolia",
      rpcUrl:        sourceRpc,
      provider:      new ethers.JsonRpcProvider(sourceRpc),
      vaultAddress:  requireEnv("VAULT_ADDRESS"),
      usdcAddress:   requireEnv("USDC_ADDRESS"),
      confirmations: optionalEnvInt("CONFIRMATIONS", 2),
      startBlock:    forwardStart,
    },
    destination: {
      name:               process.env.DEST_CHAIN_NAME ?? "Destination",
      rpcUrl:             destRpc,
      provider:           new ethers.JsonRpcProvider(destRpc),
      bridgedUsdcAddress: requireEnv("BRIDGED_USDC_ADDRESS"),
      startBlock:         reverseStart,
    },
    usdcDecimals:   optionalEnvInt("USDC_DECIMALS", 6),
    relayerKey:     requireEnv("RELAYER_PRIVATE_KEY"),
    pollIntervalMs: optionalEnvInt("POLL_INTERVAL_MS",  10_000),
    syncBatchSize:  optionalEnvInt("SYNC_BATCH_SIZE",   2_000),
    batchDelayMs:   optionalEnvInt("BATCH_DELAY_MS",      500),
    lookbackBlocks: optionalEnvInt("LOOKBACK_BLOCKS",  100_000),
  };
}
