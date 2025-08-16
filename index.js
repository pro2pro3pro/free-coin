// ======================= IMPORTS =======================
import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import express from "express";
import cron from "node-cron";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// ======================= DATABASE ======================
const dbPath = path.join(process.cwd(), "data.db");
const firstInit = !fs.existsSync(dbPath);
export const db = new Database(dbPath);
if (firstInit) db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  normal_coin INTEGER NOT NULL DEFAULT 0,
  vip_coin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime("now")),
  updated_at TEXT NOT NULL DEFAULT (datetime("now"))
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
  created_at TEXT NOT NULL DEFAULT (datetime("now")),
  UNIQUE(user_id, date, platform, subid)
);

CREATE TABLE IF NOT EXISTS daily_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  platform TEXT NOT NULL,
  link TEXT NOT NULL,
  subid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime("now")),
  UNIQUE(user_id, date, platform)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

function upsertUser(userId) {
  db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").run(userId);
}
function getUser(userId) {
  upsertUser(userId);
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
}
function setNormalCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET normal_coin = ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}
function addNormalCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET normal_coin = normal_coin + ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}
function setVipCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET vip_coin = ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}
function addVipCoin(userId, amount) {
  upsertUser(userId);
  db.prepare("UPDATE users SET vip_coin = vip_coin + ?, updated_at = datetime('now') WHERE user_id = ?").run(amount, userId);
}
function resetAllNormalCoins() {
  db.prepare("UPDATE users SET normal_coin = 0, updated_at = datetime('now')").run();
}

// ======================= DISCORD BOT =======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const commands = [
  new SlashCommandBuilder()
    .setName("getcoin")
    .setDescription("Nhận coin thường"),
  new SlashCommandBuilder()
    .setName("checkcoin")
    .setDescription("Xem số coin của bạn"),
  new SlashCommandBuilder()
    .setName("addcoin")
    .setDescription("Admin cộng coin cho user")
    .addUserOption(opt => opt.setName("target").setDescription("Người được cộng coin").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("Số coin").setRequired(true))
    .addStringOption(opt => opt.setName("type").setDescription("Loại coin").addChoices(
      { name: "normal", value: "normal" },
      { name: "vip", value: "vip" }
    ).setRequired(true))
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (err) {
    console.error("❌ Error registering commands:", err);
  }
}

client.on("ready", () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user } = interaction;

  if (commandName === "getcoin") {
    addNormalCoin(user.id, 10);
    await interaction.reply(`🎁 Bạn đã nhận **10 coin thường**!`);
  }

  if (commandName === "checkcoin") {
    const u = getUser(user.id);
    await interaction.reply(`💰 Coin của bạn: \n- Normal: ${u.normal_coin}\n- VIP: ${u.vip_coin}`);
  }

  if (commandName === "addcoin") {
    if (!process.env.ADMIN_IDS.split(",").includes(user.id)) {
      await interaction.reply("❌ Bạn không có quyền dùng lệnh này.");
      return;
    }
    const target = options.getUser("target");
    const amount = options.getInteger("amount");
    const type = options.getString("type");
    if (type === "normal") addNormalCoin(target.id, amount);
    if (type === "vip") addVipCoin(target.id, amount);
    await interaction.reply(`✅ Đã cộng **${amount} ${type} coin** cho ${target.username}`);
  }
});

// ======================= WEB SERVER =======================
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 Discord Coin Suite đang chạy!");
});

app.post("/api/callback", (req, res) => {
  const { user_id, coins } = req.body;
  if (!user_id || !coins) return res.status(400).json({ error: "Thiếu dữ liệu" });
  addNormalCoin(user_id, coins);
  res.json({ success: true, message: `Cộng ${coins} coin cho user ${user_id}` });
});

// ======================= CRON JOB =======================
cron.schedule("0 0 * * 1", () => {
  console.log("🔄 Reset normal coin (thứ 2 hàng tuần)");
  resetAllNormalCoins();
});

// ======================= START =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web server chạy tại http://localhost:${PORT}`);
});

registerCommands();
client.login(process.env.DISCORD_TOKEN);
