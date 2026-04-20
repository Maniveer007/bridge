import { ethers } from "ethers";
import { BridgeConfig } from "./config.js";
import { BRIDGE_VAULT_ABI, BRIDGED_USDC_ABI } from "./abis.js";
import { processMint, processUnlock, LockEvent, BurnEvent } from "./minter.js";
import { setLastBlock, setDestLastBlock } from "./store.js";

// ─── Generic batch-sync + polling ────────────────────────────────────────────

interface SyncOptions<E> {
  label: string;
  contract: ethers.Contract;
  filter: ethers.ContractEventName;
  provider: ethers.JsonRpcProvider;
  confirmations: number;
  batchDelayMs: number;
  startBlock: number;
  batchSize: number;
  pollIntervalMs: number;
  buildEvent: (log: ethers.EventLog) => E;
  processEvent: (event: E) => Promise<void>;
  persistBlock: (block: number) => Promise<void>;
}

/** Process a batch of decoded logs, logging errors but not throwing. */
async function processLogs<E>(
  logs: (ethers.Log | ethers.EventLog)[],
  buildEvent: (log: ethers.EventLog) => E,
  processEvent: (event: E) => Promise<void>,
  label: string
): Promise<void> {
  for (const log of logs) {
    if (!("args" in log)) continue;
    const eLog = log as ethers.EventLog;
    try {
      await processEvent(buildEvent(eLog));
    } catch (err) {
      console.error(`[${label}] processEvent failed for tx ${eLog.transactionHash}:`, err);
      // Continue — dedup will retry correctly on next run.
    }
  }
}

/** Historical sync: scan from startBlock to safeBlock in fixed-size batches. */
async function syncHistory<E>(
  opts: SyncOptions<E>,
  safeBlock: number,
  stopped: () => boolean
): Promise<number> {
  const { label, contract, filter, startBlock: from, batchSize, buildEvent, processEvent, persistBlock } = opts;

  const total = Math.max(0, safeBlock - from + 1);

  if (total === 0) {
    console.log(`[${label}/Sync] Nothing to sync — startBlock is at the chain tip.`);
    return safeBlock;
  }

  const totalBatches = Math.ceil(total / batchSize);
  console.log(
    `[${label}/Sync] Historical sync started` +
    ` | blocks ${from}…${safeBlock}` +
    ` | ${total.toLocaleString()} blocks` +
    ` | ${totalBatches} batches of ${batchSize.toLocaleString()}`
  );

  let lastProcessed = from;
  let batchNum      = 0;
  let totalEvents   = 0;

  for (let start = from; start <= safeBlock; start += batchSize) {
    if (stopped()) {
      console.log(`[${label}/Sync] Stopped mid-sync — will resume on next startup.`);
      return lastProcessed;
    }

    batchNum++;
    const end = Math.min(start + batchSize - 1, safeBlock);
    const pct = Math.round((batchNum / totalBatches) * 100);

    process.stdout.write(
      `\r[${label}/Sync] Batch ${batchNum}/${totalBatches} (${pct}%) | blocks ${start}…${end}   `
    );

    try {
      const logs = await contract.queryFilter(filter, start, end);

      if (logs.length > 0) {
        process.stdout.write(`\n[${label}/Sync]   → ${logs.length} event(s) in this batch\n`);
        totalEvents += logs.length;
        await processLogs(logs, buildEvent, processEvent, label);
      }

      lastProcessed = end;
      await persistBlock(end);
    } catch (err) {
      process.stdout.write("\n");
      console.error(`[${label}/Sync] Batch ${batchNum} failed — skipping, will retry on next startup:`, err);
    }

    if (batchNum < totalBatches) {
      await new Promise((r) => setTimeout(r, opts.batchDelayMs));
    }
  }

  process.stdout.write("\n");
  console.log(
    `[${label}/Sync] ✓ Historical sync complete` +
    ` | ${batchNum} batches` +
    ` | ${totalEvents} event(s) found` +
    ` | last block: ${safeBlock}`
  );
  return safeBlock;
}

/** Live polling: watches for new events from fromBlock onwards. */
function startLivePolling<E>(
  opts: SyncOptions<E>,
  fromBlock: number,
  stopped: () => boolean,
  onStop: () => void
): void {
  const { label, contract, filter, provider, confirmations, buildEvent, processEvent, persistBlock, pollIntervalMs } = opts;
  let cursor = fromBlock;

  async function poll(): Promise<void> {
    if (stopped()) return;

    try {
      const currentBlock = await provider.getBlockNumber();
      const safeBlock    = Math.max(0, currentBlock - confirmations);

      if (cursor > safeBlock) {
        schedule();
        return;
      }

      console.log(`[${label}/Live] Scanning blocks ${cursor}…${safeBlock}`);
      const logs = await contract.queryFilter(filter, cursor, safeBlock);

      if (logs.length > 0) {
        console.log(`[${label}/Live] Found ${logs.length} event(s)`);
      }

      await processLogs(logs, buildEvent, processEvent, label);

      cursor = safeBlock + 1;
      await persistBlock(safeBlock);
    } catch (err) {
      console.error(`[${label}/Live] Poll error:`, err);
    }

    schedule();
  }

  function schedule(): void {
    if (!stopped()) {
      setTimeout(() => void poll(), pollIntervalMs);
    } else {
      onStop();
    }
  }

  void poll();
}

// ─── Forward listener — TokensLocked → mint bUSDC ────────────────────────────

function buildLockEvent(log: ethers.EventLog): LockEvent {
  const { sender, amount, nonce, lockId, destinationChainId, destinationAddress } = log.args;
  return {
    sender,
    amount,
    nonce,
    lockId,
    destinationChainId,
    destinationAddress,
    txHash:      log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

// ─── Reverse listener — TokensBurned → unlock USDC ───────────────────────────

function buildBurnEvent(log: ethers.EventLog): BurnEvent {
  const { burner, amount, burnId, destinationChainId, destinationAddress } = log.args;
  return {
    burner,
    amount,
    burnId,
    destinationChainId,
    destinationAddress,
    txHash:      log.transactionHash,
    blockNumber: log.blockNumber,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts both the forward listener (TokensLocked → mint) and the
 * reverse listener (TokensBurned → unlock) concurrently.
 *
 * Flow on every startup for each direction:
 *   1. Historical sync — scans from startBlock to current tip in batched windows.
 *   2. Live polling    — watches for new events every pollIntervalMs.
 *
 * @returns stop() — call to gracefully halt all polling.
 */
export function startListener(config: BridgeConfig): () => void {
  let _stopped = false;

  const vault = new ethers.Contract(
    config.source.vaultAddress,
    BRIDGE_VAULT_ABI,
    config.source.provider
  );

  const bridgedUsdc = new ethers.Contract(
    config.destination.bridgedUsdcAddress,
    BRIDGED_USDC_ABI,
    config.destination.provider
  );

  // Start blocks are resolved in loadConfig():
  //   processed.json wins if > 0, otherwise falls back to env START_BLOCK.
  const forwardOpts: SyncOptions<LockEvent> = {
    label:          "Forward",
    contract:       vault,
    filter:         vault.filters.TokensLocked(),
    provider:       config.source.provider,
    confirmations:  config.source.confirmations,
    startBlock:     config.source.startBlock,
    batchSize:      config.syncBatchSize,
    batchDelayMs:   config.batchDelayMs,
    pollIntervalMs: config.pollIntervalMs,
    buildEvent:     buildLockEvent,
    processEvent:   (ev) => processMint(ev, config),
    persistBlock:   setLastBlock,
  };

  const reverseOpts: SyncOptions<BurnEvent> = {
    label:          "Reverse",
    contract:       bridgedUsdc,
    filter:         bridgedUsdc.filters.TokensBurned(),
    provider:       config.destination.provider,
    confirmations:  0,
    startBlock:     config.destination.startBlock,
    batchSize:      config.syncBatchSize,
    batchDelayMs:   config.batchDelayMs,
    pollIntervalMs: config.pollIntervalMs,
    buildEvent:     buildBurnEvent,
    processEvent:   (ev) => processUnlock(ev, config),
    persistBlock:   setDestLastBlock,
  };

  async function runListener<E>(opts: SyncOptions<E>, lookbackBlocks: number): Promise<void> {
    try {
      const currentBlock = await opts.provider.getBlockNumber();
      const safeBlock    = Math.max(0, currentBlock - opts.confirmations);

      // If startBlock is 0 (not configured), scan only the recent lookback window
      // instead of from genesis — much faster for a first run without a known deploy block.
      if (opts.startBlock === 0) {
        const fallback = Math.max(0, safeBlock - lookbackBlocks);
        console.log(
          `[${opts.label}] START_BLOCK not set — scanning last ${lookbackBlocks.toLocaleString()} blocks` +
          ` (from block ${fallback}). Set START_BLOCK in .env for exact deploy block.`
        );
        opts = { ...opts, startBlock: fallback };
      }

      const lastSynced = await syncHistory(opts, safeBlock, () => _stopped);
      if (_stopped) return;

      const liveFrom = lastSynced + 1;
      console.log(
        `\n[${opts.label}/Live] Starting live polling from block ${liveFrom}` +
        ` (interval: ${opts.pollIntervalMs}ms)\n`
      );

      startLivePolling(opts, liveFrom, () => _stopped, () =>
        console.log(`[${opts.label}/Live] Stopped.`)
      );
    } catch (err) {
      console.error(`[${opts.label}] Fatal startup error:`, err);
    }
  }

  // Run both directions concurrently — they are completely independent.
  void runListener(forwardOpts, config.lookbackBlocks);
  void runListener(reverseOpts, config.lookbackBlocks);

  return function stop() {
    _stopped = true;
    console.log("[Listener] Stop signal received — both listeners will halt after current poll.");
  };
}
