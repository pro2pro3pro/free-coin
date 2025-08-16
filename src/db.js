import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "data.db");
const firstInit = !fs.existsSync(dbPath);
export const db = new Database(dbPath);
if (firstInit) db.pragma("journal_mode = WAL");

// Schema: bỏ DEFAULT datetime("now"), chỉ giữ TEXT NOT NULL
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  normal_coin INTEGER NOT NULL DEFAULT 0,
  vip_coin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  platform TEXT NOT NULL,
  subid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT "generated",
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date, platform, subid)
);

CREATE TABLE IF NOT EXISTS daily_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  platform TEXT NOT NULL,
  link TEXT NOT NULL,
  subid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date, platform)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export function upsertUser(userId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (user_id, normal_coin, vip_coin, created_at, updated_at)
    VALUES (?, 0, 0, datetime('now'), datetime('now'))
  `).run(userId);
}

export function getUser(userId) {
  upsertUser(userId);
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
}

export function setNormalCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET normal_coin = ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}

export function addNormalCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET normal_coin = normal_coin + ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}

export function setVipCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET vip_coin = ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}

export function addVipCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET vip_coin = vip_coin + ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}

export function insertClaimGenerated(userId, date, platform, subid) {
  return db.prepare(`
    INSERT OR IGNORE INTO claims (user_id, date, platform, subid, status, created_at)
    VALUES (?, ?, ?, ?, 'generated', datetime('now'))
  `).run(userId, date, platform, subid);
}

export function getClaimBySubid(subid) {
  return db.prepare("SELECT * FROM claims WHERE subid = ?").get(subid);
}

export function markClaimAwarded(id, coins, ip) {
  return db.prepare("UPDATE claims SET status = 'awarded', coins_awarded = ?, ip = ? WHERE id = ?").run(coins, ip, id);
}

export function countAwardedTodayByPlatform(userId, date) {
  const rows = db.prepare("SELECT platform, COUNT(*) cnt FROM claims WHERE user_id = ? AND date = ? AND status='awarded' GROUP BY platform").all(userId, date);
  const map = { yeumoney:0, link4m:0, bbmkts:0 };
  for (const r of rows) map[r.platform] = r.cnt;
  return map;
}

export function getDailyLink(userId, date, platform) {
  return db.prepare("SELECT * FROM daily_links WHERE user_id=? AND date=? AND platform=?").get(userId, date, platform);
}

export function setDailyLink(userId, date, platform, link, subid) {
  return db.prepare("INSERT OR REPLACE INTO daily_links (user_id, date, platform, link, subid, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))").run(userId, date, platform, link, subid);
}

export function hasAwardedOnIP(ip, date, platform) {
  const r = db.prepare("SELECT COUNT(*) c FROM claims WHERE ip = ? AND date = ? AND platform = ? AND status='awarded'").get(ip, date, platform);
  return r ? r.c > 0 : false;
}

export function sumCoinsForUserBetween(userId, startDate, endDate) {
  const r = db.prepare("SELECT COALESCE(SUM(coins_awarded),0) s FROM claims WHERE user_id=? AND status='awarded' AND date BETWEEN ? AND ?").get(userId, startDate, endDate);
  return r ? r.s : 0;
}

export function setMeta(key,value) {
  db.prepare("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
}
export function getMeta(key) {
  const r = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  return r ? r.value : null;
}

export function resetAllNormalCoins() {
  db.prepare("UPDATE users SET normal_coin = 0, updated_at = datetime('now')").run();
}
