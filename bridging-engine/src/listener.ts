import { ethers } from "ethers";
import { BridgeConfig } from "./config.js";
import { BRIDGE_VAULT_ABI, BRIDGED_USDC_ABI } from "./abis.js";
import { processMint,   LockEvent }  from "./minter.js";
import { processUnlock, BurnEvent }  from "./releaser.js";
import { setLastBlock, setDestLastBlock } from "./store.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true when an RPC error is a rate-limit / capacity error (-32005). */
function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const inner = (e.error ?? e) as Record<string, unknown>;
    if (inner.code === -32005) return true;
    const msg = String(inner.message ?? e.message ?? "").toLowerCase();
    if (msg.includes("limit exceeded") || msg.includes("rate limit") || msg.includes("too many")) return true;
  }
  return false;
}

function buildLockEvent(log: ethers.EventLog): LockEvent {
  const { sender, amount, nonce, lockId, destinationChainId, destinationAddress } = log.args;
  return { sender, amount, nonce, lockId, destinationChainId, destinationAddress,
    txHash: log.transactionHash, blockNumber: log.blockNumber };
}

function buildBurnEvent(log: ethers.EventLog): BurnEvent {
  const { burner, amount, burnId, destinationChainId, destinationAddress } = log.args;
  return { burner, amount, burnId, destinationChainId, destinationAddress,
    txHash: log.transactionHash, blockNumber: log.blockNumber };
}

async function processLockLogs(
  logs: (ethers.Log | ethers.EventLog)[],
  config: BridgeConfig
): Promise<void> {
  for (const log of logs) {
    if (!("args" in log)) continue;
    try {
      await processMint(buildLockEvent(log as ethers.EventLog), config);
    } catch (err) {
      console.error(`[Fwd] processMint failed for lockId ${(log as ethers.EventLog).args.lockId}:`, err);
    }
  }
}

async function processBurnLogs(
  logs: (ethers.Log | ethers.EventLog)[],
  config: BridgeConfig
): Promise<void> {
  for (const log of logs) {
    if (!("args" in log)) continue;
    try {
      await processUnlock(buildBurnEvent(log as ethers.EventLog), config);
    } catch (err) {
      console.error(`[Rev] processUnlock failed for burnId ${(log as ethers.EventLog).args.burnId}:`, err);
    }
  }
}

// ─── Generic historical sync ──────────────────────────────────────────────────

interface SyncOptions {
  label:     string;        // e.g. "Fwd" / "Rev"
  contract:  ethers.Contract;
  filter:    ethers.ContractEventName;
  fromBlock: number;
  toBlock:   number;
  batchSize: number;
  delayMs:   number;
  processLogs: (logs: (ethers.Log | ethers.EventLog)[], config: BridgeConfig) => Promise<void>;
  saveCursor:  (block: number) => void;
  stopped:   () => boolean;
}

async function syncHistory(opts: SyncOptions, config: BridgeConfig): Promise<number> {
  const { label, contract, filter, fromBlock, toBlock, batchSize, delayMs } = opts;
  const total = Math.max(0, toBlock - fromBlock + 1);

  if (total === 0) {
    console.log(`[${label}/Sync] Nothing to sync — startBlock is at the chain tip.`);
    return toBlock;
  }

  const totalBatches = Math.ceil(total / batchSize);
  console.log(
    `[${label}/Sync] Started | blocks ${fromBlock}…${toBlock}` +
    ` | ${total.toLocaleString()} blocks | ${totalBatches} batches of ${batchSize.toLocaleString()}`
  );

  let lastProcessed = fromBlock;
  let batchNum      = 0;
  let totalEvents   = 0;
  const MAX_RETRIES = 6;

  for (let start = fromBlock; start <= toBlock; start += batchSize) {
    if (opts.stopped()) {
      console.log(`[${label}/Sync] Stopped mid-sync — will resume on next startup.`);
      return lastProcessed;
    }

    batchNum++;
    const end = Math.min(start + batchSize - 1, toBlock);
    const pct = Math.round((batchNum / totalBatches) * 100);

    process.stdout.write(`\r[${label}/Sync] Batch ${batchNum}/${totalBatches} (${pct}%) | ${start}…${end}   `);

    let batchOk = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const logs = await contract.queryFilter(filter, start, end);

        if (logs.length > 0) {
          process.stdout.write(`\n[${label}/Sync]   → ${logs.length} event(s)\n`);
          totalEvents += logs.length;
          await opts.processLogs(logs, config);
        }

        lastProcessed = end;
        opts.saveCursor(end);
        batchOk = true;
        break;
      } catch (err: unknown) {
        process.stdout.write("\n");
        const rl      = isRateLimitError(err);
        const backoff = delayMs * Math.pow(2, attempt);

        if (attempt === MAX_RETRIES) {
          console.error(`[${label}/Sync] Batch ${batchNum} failed after ${MAX_RETRIES} attempts — skipping ${start}…${end}.`);
        } else {
          console.warn(`[${label}/Sync] Batch ${batchNum} attempt ${attempt} failed${rl ? " (rate limit)" : ""} — retry in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    if (batchOk && batchNum < totalBatches) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  process.stdout.write("\n");
  console.log(`[${label}/Sync] ✓ Complete | ${batchNum} batches | ${totalEvents} event(s) | last block: ${toBlock}`);
  return toBlock;
}

// ─── Generic live polling ─────────────────────────────────────────────────────

function startLivePolling(opts: {
  label:        string;
  contract:     ethers.Contract;
  filter:       ethers.ContractEventName;
  provider:     ethers.JsonRpcProvider;
  confirmations: number;
  fromBlock:    number;
  intervalMs:   number;
  processLogs:  (logs: (ethers.Log | ethers.EventLog)[], config: BridgeConfig) => Promise<void>;
  saveCursor:   (block: number) => void;
  stopped:      () => boolean;
  onStop:       () => void;
  config:       BridgeConfig;
}): void {
  let cursor = opts.fromBlock;

  async function poll(): Promise<void> {
    if (opts.stopped()) return;

    try {
      const current   = await opts.provider.getBlockNumber();
      const safeBlock = Math.max(0, current - opts.confirmations);

      if (cursor <= safeBlock) {
        console.log(`[${opts.label}/Live] Scanning blocks ${cursor}…${safeBlock}`);
        const logs = await opts.contract.queryFilter(opts.filter, cursor, safeBlock);
        if (logs.length > 0) console.log(`[${opts.label}/Live] Found ${logs.length} event(s)`);
        await opts.processLogs(logs, opts.config);
        cursor = safeBlock + 1;
        opts.saveCursor(safeBlock);
      }
    } catch (err) {
      console.error(`[${opts.label}/Live] Poll error:`, err);
    }

    if (!opts.stopped()) {
      setTimeout(() => void poll(), opts.intervalMs);
    } else {
      opts.onStop();
    }
  }

  void poll();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts BOTH the forward listener (TokensLocked on BSC → mint on Amero x)
 * and the reverse listener (TokensBurned on Amero x → unlock on BSC).
 *
 * @returns stop() — gracefully halts both listeners.
 */
export function startListener(config: BridgeConfig): () => void {
  let _stopped = false;

  // ── Forward: BridgeVault on source chain ───────────────────────────────
  const vault  = new ethers.Contract(config.source.vaultAddress, BRIDGE_VAULT_ABI, config.source.provider);
  const fwdFilter = vault.filters.TokensLocked();

  // ── Reverse: BridgedUSDC on destination chain ──────────────────────────
  const bridgedUsdc = new ethers.Contract(config.destination.bridgedUsdcAddress, BRIDGED_USDC_ABI, config.destination.provider);
  const revFilter   = bridgedUsdc.filters.TokensBurned();

  // ── Forward listener IIFE ──────────────────────────────────────────────
  (async () => {
    try {
      const current   = await config.source.provider.getBlockNumber();
      const safeBlock = Math.max(0, current - config.source.confirmations);

      const lastFwd = await syncHistory({
        label:       "Fwd",
        contract:    vault,
        filter:      fwdFilter,
        fromBlock:   config.source.startBlock,
        toBlock:     safeBlock,
        batchSize:   config.syncBatchSize,
        delayMs:     config.batchDelayMs,
        processLogs: processLockLogs,
        saveCursor:  (b) => setLastBlock(b),
        stopped:     () => _stopped,
      }, config);

      if (_stopped) return;

      console.log(`\n[Fwd/Live] Starting from block ${lastFwd + 1} (interval: ${config.pollIntervalMs}ms)\n`);
      startLivePolling({
        label:         "Fwd",
        contract:      vault,
        filter:        fwdFilter,
        provider:      config.source.provider,
        confirmations: config.source.confirmations,
        fromBlock:     lastFwd + 1,
        intervalMs:    config.pollIntervalMs,
        processLogs:   processLockLogs,
        saveCursor:    (b) => setLastBlock(b),
        stopped:       () => _stopped,
        onStop:        () => console.log("[Fwd/Live] Stopped."),
        config,
      });
    } catch (err) {
      console.error("[Fwd] Fatal startup error:", err);
    }
  })();

  // ── Reverse listener IIFE ─────────────────────────────────────────────
  (async () => {
    try {
      const current   = await config.destination.provider.getBlockNumber();
      // Dest chain is a private node — no Infura rate limits, use small confirmations
      const safeBlock = Math.max(0, current - 2);

      const lastRev = await syncHistory({
        label:       "Rev",
        contract:    bridgedUsdc,
        filter:      revFilter,
        fromBlock:   config.destination.startBlock,
        toBlock:     safeBlock,
        // Dest chain is a local node — larger batches are fine
        batchSize:   Math.min(config.syncBatchSize * 4, 10_000),
        delayMs:     50,
        processLogs: processBurnLogs,
        saveCursor:  (b) => setDestLastBlock(b),
        stopped:     () => _stopped,
      }, config);

      if (_stopped) return;

      console.log(`\n[Rev/Live] Starting from block ${lastRev + 1} (interval: ${config.pollIntervalMs}ms)\n`);
      startLivePolling({
        label:         "Rev",
        contract:      bridgedUsdc,
        filter:        revFilter,
        provider:      config.destination.provider,
        confirmations: 2,
        fromBlock:     lastRev + 1,
        intervalMs:    config.pollIntervalMs,
        processLogs:   processBurnLogs,
        saveCursor:    (b) => setDestLastBlock(b),
        stopped:       () => _stopped,
        onStop:        () => console.log("[Rev/Live] Stopped."),
        config,
      });
    } catch (err) {
      console.error("[Rev] Fatal startup error:", err);
    }
  })();

  return function stop() {
    _stopped = true;
    console.log("[Listener] Stop signal received — halting both listeners.");
  };
}
