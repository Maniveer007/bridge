import { MongoClient } from "mongodb";

// ─── Connection ───────────────────────────────────────────────────────────────

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("[Store] MONGODB_URI is not set");

const client = new MongoClient(uri);
let connected = false;

async function getDb() {
  if (!connected) {
    await client.connect();
    connected = true;

    const db = client.db("bridge");

    // Dedup indexes — unique so duplicate inserts are silently ignored.
    await db.collection("processed_locks").createIndex(   { lockId: 1 }, { unique: true });
    await db.collection("processed_releases").createIndex({ burnId: 1 }, { unique: true });

    // Main transactions — sparse so old null-txId docs don't block uniqueness.
    await db.collection("transactions").createIndex({ txId: 1 }, { unique: true, sparse: true });
    await db.collection("transactions").createIndex({ fromAddress: 1 });

    // User transaction links (frontend-owned).
    await db.collection("user_transactions").createIndex({ tempId: 1 }, { unique: true });
    await db.collection("user_transactions").createIndex({ userAddress: 1 });
  }
  return client.db("bridge");
}

// ─── Forward dedup ────────────────────────────────────────────────────────────

export async function isProcessed(lockId: string): Promise<boolean> {
  const db = await getDb();
  return !!(await db.collection("processed_locks").findOne({ lockId: lockId.toLowerCase() }));
}

export async function markProcessed(lockId: string): Promise<void> {
  const db = await getDb();
  await db.collection("processed_locks").updateOne(
    { lockId: lockId.toLowerCase() },
    { $setOnInsert: { lockId: lockId.toLowerCase(), processedAt: new Date() } },
    { upsert: true }
  );
}

// ─── Reverse dedup ────────────────────────────────────────────────────────────

export async function isReleaseProcessed(burnId: string): Promise<boolean> {
  const db = await getDb();
  return !!(await db.collection("processed_releases").findOne({ burnId: burnId.toLowerCase() }));
}

export async function markReleaseProcessed(burnId: string): Promise<void> {
  const db = await getDb();
  await db.collection("processed_releases").updateOne(
    { burnId: burnId.toLowerCase() },
    { $setOnInsert: { burnId: burnId.toLowerCase(), processedAt: new Date() } },
    { upsert: true }
  );
}

// ─── Block cursors ────────────────────────────────────────────────────────────

async function getCursor(key: string): Promise<number> {
  const db  = await getDb();
  const doc = await db.collection("engine_cursors").findOne({ _id: key as unknown as undefined });
  return (doc?.block as number | undefined) ?? 0;
}

async function setCursor(key: string, block: number): Promise<void> {
  const db = await getDb();
  await db.collection("engine_cursors").updateOne(
    { _id: key as unknown as undefined },
    { $max: { block } },
    { upsert: true }
  );
}

export async function getLastBlock(): Promise<number>            { return getCursor("lastBlock"); }
export async function setLastBlock(block: number): Promise<void> { return setCursor("lastBlock", block); }
export async function getDestLastBlock(): Promise<number>        { return getCursor("destLastBlock"); }
export async function setDestLastBlock(block: number): Promise<void> { return setCursor("destLastBlock", block); }

// ─── Bridge transactions (relayer-owned — source of truth) ───────────────────
//
// Written when the relayer first sees a lock/burn event (status "pending"),
// then updated to "completed" once the relayer's mint/unlock confirms on-chain.

export interface BridgeTx {
  txId:         string;           // lockId (forward) or burnId (reverse)
  direction:    "forward" | "reverse";
  fromAddress:  string;           // user address from the event
  toAddress:    string;
  amount:       string;           // human-readable (e.g. "10.5")
  sourceChain:  string;
  destChain:    string;
  lockTxHash:   string | null;    // user's lock tx (forward)
  mintTxHash:   string | null;    // relayer's mint tx (forward)
  burnTxHash:   string | null;    // user's burn tx (reverse)
  unlockTxHash: string | null;    // relayer's unlock tx (reverse)
  status:       "pending" | "completed" | "failed";
  error:        string | null;
  blockNumber:  number;
  createdAt:    Date;
  completedAt:  Date | null;
}

/** Upsert a transaction record — idempotent, never overwrites a completed record. */
export async function saveBridgeTx(tx: BridgeTx): Promise<void> {
  const db = await getDb();
  await db.collection("transactions").updateOne(
    { txId: tx.txId.toLowerCase() },
    { $setOnInsert: { ...tx, txId: tx.txId.toLowerCase(), fromAddress: tx.fromAddress.toLowerCase() } },
    { upsert: true }
  );
}

/** Mark a transaction completed and record the relayer tx hash. */
export async function completeBridgeTx(txId: string, relayerTxHash: string): Promise<void> {
  const db  = await getDb();
  const doc = await db.collection<BridgeTx>("transactions").findOne({ txId: txId.toLowerCase() });
  const field = doc?.direction === "reverse" ? "unlockTxHash" : "mintTxHash";
  await db.collection("transactions").updateOne(
    { txId: txId.toLowerCase() },
    { $set: { status: "completed", [field]: relayerTxHash, completedAt: new Date() } }
  );
}

/** Mark a transaction failed. */
export async function failBridgeTx(txId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.collection("transactions").updateOne(
    { txId: txId.toLowerCase() },
    { $set: { status: "failed", error, completedAt: new Date() } }
  );
}

// ─── User transactions (frontend-owned) ──────────────────────────────────────
//
// Lightweight link: wallet address → txId. Status always comes from BridgeTx.

export interface UserTx {
  tempId:        string;
  userAddress:   string;
  txId:          string | null;
  approveTxHash: string | null;
  lockTxHash:    string | null;
  burnTxHash:    string | null;
  direction:     "forward" | "reverse";
  amount:        string;
  sourceChain:   string;
  destChain:     string;
  timestamp:     number;
}

export interface UserTxWithStatus extends UserTx {
  status:       "pending" | "completed" | "failed";
  mintTxHash:   string | null;
  unlockTxHash: string | null;
  error:        string | null;
  completedAt:  Date | null;
}

/** Return up to 50 most-recent user txs with live status joined from transactions. */
export async function getUserTxsWithStatus(userAddress: string): Promise<UserTxWithStatus[]> {
  const db = await getDb();

  const userTxs = await db
    .collection<UserTx>("user_transactions")
    .find({ userAddress: userAddress.toLowerCase() })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  const txIds = userTxs
    .map((t) => t.txId?.toLowerCase())
    .filter((id): id is string => !!id);

  const bridgeTxs = txIds.length
    ? await db.collection<BridgeTx>("transactions").find({ txId: { $in: txIds } }).toArray()
    : [];

  const map = new Map(bridgeTxs.map((t) => [t.txId, t]));

  return userTxs.map((u) => {
    const bt = u.txId ? map.get(u.txId.toLowerCase()) : undefined;
    return {
      ...u,
      status:       bt?.status       ?? "pending",
      mintTxHash:   bt?.mintTxHash   ?? null,
      unlockTxHash: bt?.unlockTxHash ?? null,
      error:        bt?.error        ?? null,
      completedAt:  bt?.completedAt  ?? null,
    };
  });
}

export async function saveUserTx(tx: UserTx): Promise<void> {
  const db = await getDb();
  await db.collection("user_transactions").updateOne(
    { tempId: tx.tempId },
    { $setOnInsert: { ...tx, userAddress: tx.userAddress.toLowerCase() } },
    { upsert: true }
  );
}

export async function patchUserTx(tempId: string, patch: Partial<UserTx>): Promise<void> {
  const db = await getDb();
  const allowed: (keyof UserTx)[] = ["txId", "approveTxHash", "lockTxHash", "burnTxHash"];
  const safe: Partial<UserTx> = {};
  for (const key of allowed) {
    if (key in patch) (safe as Record<string, unknown>)[key] = patch[key];
  }
  if (Object.keys(safe).length) {
    await db.collection("user_transactions").updateOne({ tempId }, { $set: safe });
  }
}

export async function clearUserTxs(userAddress: string): Promise<void> {
  const db = await getDb();
  await db.collection("user_transactions").deleteMany({ userAddress: userAddress.toLowerCase() });
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export async function clearStore(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection("processed_locks").deleteMany({}),
    db.collection("processed_releases").deleteMany({}),
    db.collection("transactions").deleteMany({}),
    db.collection("engine_cursors").deleteMany({}),
  ]);
  console.log("[Store] Cleared.");
}

export async function closeStore(): Promise<void> {
  if (connected) { await client.close(); connected = false; }
}
