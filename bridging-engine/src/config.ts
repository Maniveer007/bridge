import { ethers } from "ethers";
import { getLastBlock, getDestLastBlock } from "./store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChainConfig {
  name:     string;
  rpcUrl:   string;
  provider: ethers.JsonRpcProvider;
}

export interface BridgeConfig {
  /** Source chain — where USDC is locked (BSC). */
  source: ChainConfig & {
    vaultAddress:  string;
    usdcAddress:   string;
    confirmations: number;
    /** Block to start scanning from — max(ENV START_BLOCK, last MongoDB cursor). */
    startBlock:    number;
  };
  /** Destination chain — where bUSDC is minted. */
  destination: ChainConfig & {
    bridgedUsdcAddress: string;
    /** Block to start scanning dest-chain events from. */
    startBlock:         number;
  };
  /** Relayer wallet — signs mint / unlock transactions. */
  relayerKey:      string;
  /** Decimals of the bridged token (USDC_DECIMALS env, default 18). */
  tokenDecimals:   number;
  /** How often the live-polling loop checks for new events (ms). */
  pollIntervalMs: number;
  /** Blocks per eth_getLogs call during historical sync. */
  syncBatchSize:  number;
  /** Pause between sync batches to stay under RPC rate limits (ms). */
  batchDelayMs:   number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Build the entire bridge config from environment variables.
 * Async because it reads the MongoDB cursors so the engine always resumes from
 * the last processed block rather than re-scanning from START_BLOCK on restart.
 */
export async function loadConfig(): Promise<BridgeConfig> {
  const sourceRpc = requireEnv("SOURCE_RPC_URL");
  const destRpc   = requireEnv("DEST_RPC_URL");

  const envStartBlock     = optionalEnvInt("START_BLOCK",      0);
  const envDestStartBlock = optionalEnvInt("DEST_START_BLOCK", 0);

  // Resume from MongoDB cursor (or fall back to env var if cursor is 0 / unset).
  const mongoSourceCursor = await getLastBlock();
  const mongoDestCursor   = await getDestLastBlock();

  const sourceStartBlock = Math.max(envStartBlock, mongoSourceCursor);
  const destStartBlock   = Math.max(envDestStartBlock, mongoDestCursor);

  if (mongoSourceCursor > 0) {
    console.log(
      `[Config] Source chain  — resuming from MongoDB cursor block ${mongoSourceCursor}` +
      (mongoSourceCursor > envStartBlock ? `` : ` (ENV START_BLOCK wins)`)
    );
  }
  if (mongoDestCursor > 0) {
    console.log(
      `[Config] Dest chain    — resuming from MongoDB cursor block ${mongoDestCursor}` +
      (mongoDestCursor > envDestStartBlock ? `` : ` (DEST_START_BLOCK wins)`)
    );
  }

  return {
    source: {
      name:         process.env.SOURCE_CHAIN_NAME ?? "BSC",
      rpcUrl:       sourceRpc,
      // batchMaxCount:1 disables ethers.js JSON-RPC batching; public BSC nodes
      // reject batched requests with -32005 "Too Many Requests".
      provider:     new ethers.JsonRpcProvider(sourceRpc, undefined, { batchMaxCount: 1 }),
      vaultAddress: requireEnv("VAULT_ADDRESS"),
      usdcAddress:  requireEnv("USDC_ADDRESS"),
      confirmations: optionalEnvInt("CONFIRMATIONS", 2),
      startBlock:   sourceStartBlock,
    },
    destination: {
      name:               process.env.DEST_CHAIN_NAME ?? "Destination",
      rpcUrl:             destRpc,
      provider:           new ethers.JsonRpcProvider(destRpc, undefined, { batchMaxCount: 1 }),
      bridgedUsdcAddress: requireEnv("BRIDGED_USDC_ADDRESS"),
      startBlock:         destStartBlock,
    },
    relayerKey:     requireEnv("RELAYER_PRIVATE_KEY"),
    tokenDecimals:  optionalEnvInt("USDC_DECIMALS", 18),
    pollIntervalMs:  optionalEnvInt("POLL_INTERVAL_MS", 10_000),
    syncBatchSize:   optionalEnvInt("SYNC_BATCH_SIZE",  2_000),
    batchDelayMs:    optionalEnvInt("BATCH_DELAY_MS",   500),
  };
}
