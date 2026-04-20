import { MongoClient } from "mongodb";

// ─── Connection ───────────────────────────────────────────────────────────────

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("[Store] MONGODB_URI is not set in environment variables");

const client = new MongoClient(uri);
let connected = false;

async function getDb() {
  if (!connected) {
    await client.connect();
    connected = true;

    // Ensure unique indexes for O(1) dedup lookups.
    const db = client.db("bridge");
    await db.collection("processed_locks").createIndex({ lockId: 1 }, { unique: true });
    await db.collection("processed_releases").createIndex({ burnId: 1 }, { unique: true });
  }
  return client.db("bridge");
}

// ─── Forward bridge (lockId → mint) ──────────────────────────────────────────

/** Returns true if this lockId was already minted successfully. */
export async function isProcessed(lockId: string): Promise<boolean> {
  const db  = await getDb();
  const doc = await db.collection("processed_locks").findOne({ lockId: lockId.toLowerCase() });
  return doc !== null;
}

/** Persist a successfully minted lockId so we never mint it again. */
export async function markProcessed(lockId: string): Promise<void> {
  const db = await getDb();
  await db.collection("processed_locks").updateOne(
    { lockId: lockId.toLowerCase() },
    { $setOnInsert: { lockId: lockId.toLowerCase(), processedAt: new Date() } },
    { upsert: true }
  );
}

// ─── Reverse bridge (burnId → unlock) ────────────────────────────────────────

/** Returns true if this burnId was already unlocked on source successfully. */
export async function isReleaseProcessed(burnId: string): Promise<boolean> {
  const db  = await getDb();
  const doc = await db.collection("processed_releases").findOne({ burnId: burnId.toLowerCase() });
  return doc !== null;
}

/** Persist a successfully unlocked burnId so we never unlock it again. */
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

/** Return the last source-chain block we fully processed. */
export async function getLastBlock(): Promise<number> {
  return getCursor("lastBlock");
}

/** Persist the highest source-chain block we have fully processed. */
export async function setLastBlock(block: number): Promise<void> {
  return setCursor("lastBlock", block);
}

/** Return the last destination-chain block the burn listener processed. */
export async function getDestLastBlock(): Promise<number> {
  return getCursor("destLastBlock");
}

/** Persist the highest destination-chain block the burn listener processed. */
export async function setDestLastBlock(block: number): Promise<void> {
  return setCursor("destLastBlock", block);
}

// ─── Wipe / fresh start ───────────────────────────────────────────────────────

/** Wipe the store completely — used by the --fresh flag on startup. */
export async function clearStore(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection("processed_locks").deleteMany({}),
    db.collection("processed_releases").deleteMany({}),
    db.collection("engine_cursors").deleteMany({}),
  ]);
  console.log("[Store] MongoDB store cleared.");
}

/** Close the MongoDB connection gracefully (call on SIGTERM/SIGINT). */
export async function closeStore(): Promise<void> {
  if (connected) {
    await client.close();
    connected = false;
  }
}
