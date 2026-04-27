import { ethers } from "ethers";
import { BridgeConfig } from "./config.js";
import { BRIDGE_VAULT_ABI } from "./abis.js";
import {
  isReleaseProcessed,
  markReleaseProcessed,
  saveBridgeTx,
  completeBridgeTx,
  failBridgeTx,
} from "./store.js";

const MAX_RETRIES   = 3;
const RETRY_BASE_MS = 2_000;

export interface BurnEvent {
  burner:             string;
  amount:             bigint;
  burnId:             string;
  destinationChainId: bigint;
  destinationAddress: string;   // address on BSC to receive USDC
  txHash:             string;
  blockNumber:        number;
}

/**
 * Unlock USDC on the source chain (BSC) in response to a TokensBurned event
 * on the destination chain (Amero x).
 * Idempotent — skips if the burnId was already processed locally or on-chain.
 * Saves a BridgeTx record to MongoDB and updates it to "completed" / "failed".
 */
export async function processUnlock(
  event: BurnEvent,
  config: BridgeConfig
): Promise<void> {
  const { burnId, amount, destinationAddress, txHash, blockNumber, burner } = event;

  // ── Local deduplication ─────────────────────────────────────────────────
  if (await isReleaseProcessed(burnId)) {
    console.log(`[Releaser] Already processed locally — skipping burnId: ${burnId}`);
    return;
  }

  const relayerWallet = new ethers.Wallet(
    config.relayerKey,
    config.source.provider   // vault lives on the SOURCE chain
  );

  const vault = new ethers.Contract(
    config.source.vaultAddress,
    BRIDGE_VAULT_ABI,
    relayerWallet
  );

  // ── On-chain deduplication ──────────────────────────────────────────────
  const alreadyUnlocked = await vault.processedReleases(burnId);
  if (alreadyUnlocked) {
    console.log(`[Releaser] Already unlocked on-chain — marking local store. burnId: ${burnId}`);
    await markReleaseProcessed(burnId);
    return;
  }

  // ── Persist a "pending" record so the frontend can see it immediately ───
  const humanAmount = ethers.formatUnits(amount, config.tokenDecimals);
  await saveBridgeTx({
    txId:         burnId,
    direction:    "reverse",
    fromAddress:  burner,
    toAddress:    destinationAddress,
    amount:       humanAmount,
    sourceChain:  config.destination.name,   // where the burn happened
    destChain:    config.source.name,         // where USDC is unlocked
    lockTxHash:   null,
    mintTxHash:   null,
    burnTxHash:   txHash,
    unlockTxHash: null,
    status:       "pending",
    error:        null,
    blockNumber,
    createdAt:    new Date(),
    completedAt:  null,
  });

  // ── Unlock with retry ───────────────────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[Releaser] Attempt ${attempt}/${MAX_RETRIES} — unlocking ${humanAmount} USDC` +
        ` to ${destinationAddress} | burnId: ${burnId} | burnTx: ${txHash}`
      );

      const tx      = await vault.unlock(destinationAddress, amount, burnId);
      console.log(`[Releaser] Tx submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[Releaser] Confirmed in block ${receipt.blockNumber} — burnId: ${burnId}`);

      await markReleaseProcessed(burnId);
      await completeBridgeTx(burnId, tx.hash);
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Releaser] Attempt ${attempt} failed: ${msg}`);

      if (attempt === MAX_RETRIES) {
        await failBridgeTx(burnId, msg);
        throw new Error(
          `[Releaser] All ${MAX_RETRIES} attempts failed for burnId ${burnId}. Manual intervention required.`
        );
      }

      const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.log(`[Releaser] Retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
