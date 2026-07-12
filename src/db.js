/**
 * Persistência local SQLite (node:sqlite) — posts, gerações e uso de tokens.
 * Arquivo: <project>/.data/tweet-ia.sqlite
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PROJECT_ROOT } from "./config.js";

const DATA_DIR = resolve(PROJECT_ROOT, ".data");
const DB_PATH = resolve(DATA_DIR, "tweet-ia.sqlite");

let dbInstance = null;

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      command TEXT,
      status TEXT NOT NULL,
      text TEXT NOT NULL,
      char_count INTEGER NOT NULL DEFAULT 0,
      topic TEXT,
      lang TEXT,
      tone TEXT,
      modes TEXT,
      long_form INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      username TEXT,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
      purpose TEXT,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at DESC);
  `);
}

export function getDbPath() {
  return DB_PATH;
}

export function getDb() {
  if (dbInstance) return dbInstance;
  mkdirSync(DATA_DIR, { recursive: true });
  dbInstance = new DatabaseSync(DB_PATH);
  ensureSchema(dbInstance);
  return dbInstance;
}

function usageFromMeta(meta) {
  const u = meta?.usage || {};
  const prompt = Number(u.promptTokens || 0);
  const completion = Number(u.completionTokens || 0);
  const total = Number(u.totalTokens || prompt + completion);
  return {
    model: meta?.model || null,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cost_usd: Number(meta?.costUsd || 0),
  };
}

/**
 * @param {object} row
 * @param {string} row.command
 * @param {string} row.status - generated | transformed | published | cancelled
 * @param {string} row.text
 * @param {object} [row.meta] - cost/usage meta do OpenRouter
 * @param {string} [row.topic]
 * @param {string} [row.lang]
 * @param {string} [row.tone]
 * @param {string[]} [row.modes]
 * @param {boolean} [row.longForm]
 * @param {string} [row.username]
 * @param {string} [row.purpose] - generate | transform | shorten
 */
export function savePost(row) {
  const db = getDb();
  const usage = usageFromMeta(row.meta);
  const text = String(row.text || "");
  const modes = Array.isArray(row.modes) ? JSON.stringify(row.modes) : row.modes || null;
  const publishedAt = row.status === "published" ? new Date().toISOString() : null;

  const insert = db.prepare(`
    INSERT INTO posts (
      command, status, text, char_count, topic, lang, tone, modes, long_form,
      model, prompt_tokens, completion_tokens, total_tokens, cost_usd,
      username, published_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `);

  insert.run(
    row.command || null,
    row.status,
    text,
    [...text].length,
    row.topic || null,
    row.lang || null,
    row.tone || null,
    modes,
    row.longForm ? 1 : 0,
    usage.model,
    usage.prompt_tokens,
    usage.completion_tokens,
    usage.total_tokens,
    usage.cost_usd,
    row.username || null,
    publishedAt,
  );

  const postId = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);

  if (usage.total_tokens > 0 || usage.cost_usd > 0) {
    recordUsage({
      postId,
      purpose: row.purpose || row.command || "llm",
      model: usage.model,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      costUsd: usage.cost_usd,
    });
  }

  return postId;
}

export function markPublished(postId, { username } = {}) {
  const db = getDb();
  db.prepare(
    `UPDATE posts
     SET status = 'published',
         published_at = datetime('now'),
         username = COALESCE(?, username)
     WHERE id = ?`,
  ).run(username || null, postId);
}

export function recordUsage({
  postId = null,
  purpose = "llm",
  model = null,
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  costUsd = 0,
} = {}) {
  const db = getDb();
  const total = totalTokens || promptTokens + completionTokens;
  db.prepare(
    `INSERT INTO usage_events (
      post_id, purpose, model, prompt_tokens, completion_tokens, total_tokens, cost_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    postId,
    purpose,
    model,
    Number(promptTokens || 0),
    Number(completionTokens || 0),
    Number(total || 0),
    Number(costUsd || 0),
  );
}

export function listPosts({ limit = 20, status = null } = {}) {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, Number(limit) || 20));
  if (status) {
    return db
      .prepare(
        `SELECT id, created_at, command, status, char_count, model,
                prompt_tokens, completion_tokens, total_tokens, cost_usd,
                username, published_at,
                substr(text, 1, 120) AS preview
         FROM posts WHERE status = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(status, lim);
  }
  return db
    .prepare(
      `SELECT id, created_at, command, status, char_count, model,
              prompt_tokens, completion_tokens, total_tokens, cost_usd,
              username, published_at,
              substr(text, 1, 120) AS preview
       FROM posts ORDER BY id DESC LIMIT ?`,
    )
    .all(lim);
}

export function getPost(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM posts WHERE id = ?`).get(Number(id));
}

export function getStats() {
  const db = getDb();
  const posts = db
    .prepare(
      `SELECT
         COUNT(*) AS total_posts,
         SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN status IN ('generated','transformed','cancelled') THEN 1 ELSE 0 END) AS drafts,
         SUM(char_count) AS chars_total,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(completion_tokens) AS completion_tokens,
         SUM(total_tokens) AS total_tokens,
         SUM(cost_usd) AS cost_usd
       FROM posts`,
    )
    .get();

  const usage = db
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         SUM(prompt_tokens) AS prompt_tokens,
         SUM(completion_tokens) AS completion_tokens,
         SUM(total_tokens) AS total_tokens,
         SUM(cost_usd) AS cost_usd
       FROM usage_events`,
    )
    .get();

  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*) AS calls,
              SUM(total_tokens) AS total_tokens,
              SUM(cost_usd) AS cost_usd
       FROM usage_events
       WHERE model IS NOT NULL
       GROUP BY model
       ORDER BY total_tokens DESC
       LIMIT 15`,
    )
    .all();

  return { posts, usage, byModel, dbPath: DB_PATH };
}
