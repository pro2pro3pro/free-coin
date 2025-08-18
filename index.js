import express from "express";
import sqlite3 from "better-sqlite3";
import fetch from "node-fetch";
import cron from "node-cron";

const app = express();
const PORT = process.env.PORT || 10000;
const TOKEN = process.env.BOT_TOKEN;
const BASE_URL = `https://discord.com/api/v10`;

// Kết nối SQLite
const db = sqlite3("database.db");

// Tạo bảng
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    coins INTEGER DEFAULT 0,
    created_at DATETIME
  )
`).run();

// Hàm gọi API Discord
async function discordRequest(endpoint, options) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      "Authorization": `Bot ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...options,
  });
  return res.json();
}

// Đăng ký slash commands
async function registerCommands() {
  const commands = [
    {
      name: "getcoin",
      description: "Nhận 10 coin miễn phí",
    },
    {
      name: "checkcoin",
      description: "Xem số coin hiện tại của bạn",
    },
  ];

  await discordRequest(`/applications/${process.env.CLIENT_ID}/commands`, {
    method: "PUT",
    body: JSON.stringify(commands),
  });

  console.log("✅ Slash commands registered");
}

// Xử lý sự kiện từ Discord (interactions)
app.post("/interactions", express.json(), async (req, res) => {
  const { type, data, member } = req.body;

  if (type === 1) {
    // Ping check
    return res.send({ type: 1 });
  }

  if (type === 2) {
    const userId = member.user.id;

    if (data.name === "getcoin") {
      // Thêm user nếu chưa tồn tại
      db.prepare(`
        INSERT OR IGNORE INTO users (id, coins, created_at) VALUES (?, ?, ?)
      `).run(userId, 0, new Date().toISOString());

      // Cộng coin
      db.prepare("UPDATE users SET coins = coins + 10 WHERE id = ?").run(userId);

      return res.send({
        type: 4,
        data: { content: `🎉 Bạn vừa nhận được **10 coin**!` },
      });
    }

    if (data.name === "checkcoin") {
      const row = db.prepare("SELECT coins FROM users WHERE id = ?").get(userId);
      const coins = row ? row.coins : 0;

      return res.send({
        type: 4,
        data: { content: `💰 Bạn đang có **${coins} coin**.` },
      });
    }
  }
});

// Cron job (ví dụ mỗi ngày reset coin)
cron.schedule("0 0 * * *", () => {
  console.log("⏰ Reset coin hằng ngày...");
  db.prepare("UPDATE users SET coins = 0").run();
});

// Khởi chạy server
app.listen(PORT, async () => {
  console.log(`🚀 Bot is running on port ${PORT}`);
  await registerCommands();
});
