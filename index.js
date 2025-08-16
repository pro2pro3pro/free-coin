import "dotenv/config";
import express from "express";
import session from "express-session";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import dayjs from "dayjs";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import {
  db,
  upsertUser,
  getUser,
  setNormalCoin,
  addNormalCoin,
  setVipCoin,
  addVipCoin,
  insertClaimGenerated,
  getDailyLink,
  setDailyLink,
  getClaimBySubid,
  markClaimAwarded,
  countAwardedTodayByPlatform,
  hasAwardedOnIP,
  sumCoinsForUserBetween,
  resetAllNormalCoins,
  setMeta,
  getMeta,
} from "./src/db.js";
import { computeCoins } from "./src/coin.js";
import { shorten } from "./src/shortener.js";
import { getCurrentMultiplier, renderMultiplierTable } from "./src/multiplier.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use("/public", express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("tiny"));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_me",
    resave: false,
    saveUninitialized: false,
  })
);

// -------- Bot setup ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});
export function getClient() {
  return client;
}

// Đăng ký slash commands (duy nhất, không import trùng)
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("getcoin")
      .setDescription("Nhận link vượt coin (menu 5 phút)"),
    new SlashCommandBuilder()
      .setName("checkcoin")
      .setDescription("Xem Normal/VIP coin, tổng tuần/tháng & hệ số"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log("✔ Registered slash commands");
  } catch (e) {
    console.error("Register commands error:", e.message);
  }
}

// Utilities
function todayStr() {
  return dayjs().format("YYYY-MM-DD");
}
function makeSubId(userId, platform) {
  return `${platform}-${userId}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
const PLATFORM_LIMITS = { yeumoney: 2, link4m: 1, bbmkts: 1 };

async function ensureUserDailyLink(userId, platform) {
  const date = todayStr();
  const existing = getDailyLink(userId, date, platform);
  if (existing) return existing;
  const subid = makeSubId(userId, platform);
  const longUrlBase =
    process.env.BASE_CLAIM_URL ||
    `http://localhost:${process.env.PORT || 3000}/claim`;
  const longUrl = `${longUrlBase}?platform=${platform}&subid=${encodeURIComponent(
    subid
  )}&uid=${userId}`;
  const short = await shorten(platform, longUrl);
  setDailyLink(userId, date, platform, short, subid);
  insertClaimGenerated(userId, date, platform, subid);
  return getDailyLink(userId, date, platform);
}

// Bot interaction handlers
function buildMenuEmbed(userId) {
  const m = getCurrentMultiplier();
  const y = computeCoins("yeumoney").total;
  const l = computeCoins("link4m").total;
  const b = computeCoins("bbmkts").total;
  // remaining
  const counts = countAwardedTodayByPlatform(userId, todayStr());
  const remY = Math.max(0, (PLATFORM_LIMITS.yeumoney || 0) - (counts.yeumoney || 0));
  const remL = Math.max(0, (PLATFORM_LIMITS.link4m || 0) - (counts.link4m || 0));
  const remB = Math.max(0, (PLATFORM_LIMITS.bbmkts || 0) - (counts.bbmkts || 0));
  return new EmbedBuilder()
    .setTitle("Vượt link sớm để nhận nhiều coin hơn!")
    .setDescription(
      `Hệ số hiện tại: x${m.toFixed(3)}\nNormal coin reset vào Thứ 2 hàng tuần.`
    )
    .addFields(
      { name: "YeuMoney", value: `~ ${y} coin (Còn: ${remY})`, inline: true },
      { name: "Link4m", value: `~ ${l} coin (Còn: ${remL})`, inline: true },
      { name: "Bbmkts", value: `~ ${b} coin (Còn: ${remB})`, inline: true }
    )
    .setColor(0x5865f2)
    .setFooter({
      text: "Menu sống 5 phút - ai bấm cũng được, mỗi người link riêng",
    });
}

function menuButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("getcoin:yeumoney")
      .setLabel("YeuMoney")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("getcoin:link4m")
      .setLabel("Link4m")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("getcoin:bbmkts")
      .setLabel("BBMKTS")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("getcoin:help")
      .setLabel("Xem coin")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

async function handleGetcoinCmd(interaction) {
  const embed = buildMenuEmbed(interaction.user.id);
  const msg = await interaction.reply({
    embeds: [embed],
    components: [menuButtons(false)],
    ephemeral: false,
  });
  setTimeout(async () => {
    try {
      await msg.edit({ components: [menuButtons(true)] });
    } catch {}
  }, 5 * 60 * 1000);
}

async function handleGetcoinClick(interaction, platform) {
  if (platform === "help") return handleCheckcoin(interaction, true);
  const userId = interaction.user.id;
  upsertUser(userId);
  // check counts
  const counts = countAwardedTodayByPlatform(userId, todayStr());
  if ((counts[platform] || 0) >= (PLATFORM_LIMITS[platform] || 0)) {
    const embed = new EmbedBuilder()
      .setTitle("Hết lượt hôm nay")
      .setDescription(`Bạn đã dùng hết lượt cho ${platform}`)
      .setColor(0xed4245);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  const entry = await ensureUserDailyLink(userId, platform);
  const { base, multiplier, total } = computeCoins(platform);
  try {
    const dm = await interaction.user.createDM();
    await dm.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Link ${platform} của bạn`)
          .setDescription(
            `Coin gốc: ${base}\nHệ số: x${multiplier.toFixed(
              3
            )}\nNếu claim bây giờ: ~ ${total} coin\n\nLink của bạn:\n${entry.link}`
          )
          .setColor(0x2ecc71),
      ],
    });
  } catch {}
  try {
    await interaction.reply({
      content: "Mình đã gửi link vào DM của bạn nhé!",
      ephemeral: true,
    });
  } catch {}
  // update menu (best-effort)
  try {
    await interaction.message.edit({
      embeds: [buildMenuEmbed(userId)],
      components: [menuButtons(false)],
    });
  } catch {}
}

async function handleCheckcoin(interaction, ephemeral = true) {
  const userId = interaction.user.id;
  const u = getUser(userId);
  const total = (u.normal_coin || 0) + (u.vip_coin || 0);
  const m = getCurrentMultiplier();

  // week/month range
  const now = dayjs();
  const weekStart =
    now.day() === 0
      ? now.add(-6, "day").startOf("day")
      : now.add(1 - now.day(), "day").startOf("day");
  const weekEnd = dayjs(weekStart).add(6, "day");
  const weekly = sumCoinsForUserBetween(
    userId,
    weekStart.format("YYYY-MM-DD"),
    weekEnd.format("YYYY-MM-DD")
  );
  const monthStart = now.startOf("month"),
    monthEnd = now.endOf("month");
  const monthly = sumCoinsForUserBetween(
    userId,
    monthStart.format("YYYY-MM-DD"),
    monthEnd.format("YYYY-MM-DD")
  );

  const embed = new EmbedBuilder()
    .setTitle("Thông tin coin của bạn")
    .setDescription(
      "Normal coin reset vào 00:00 Thứ 2 hàng tuần. VIP coin không reset (admin cộng)."
    )
    .addFields(
      { name: "Bạn còn (Normal+VIP)", value: `${total} coin`, inline: true },
      { name: "Normal coin", value: `${u.normal_coin}`, inline: true },
      { name: "VIP coin", value: `${u.vip_coin}`, inline: true },
      { name: "Tổng tuần", value: `${weekly}`, inline: true },
      { name: "Tổng tháng", value: `${monthly}`, inline: true },
      { name: "Hệ số hiện tại", value: `x${m.toFixed(3)}`, inline: true }
    )
    .setColor(0xffc300);

  const table = "```" + renderMultiplierTable() + "```";
  return interaction.reply({ embeds: [embed], content: table, ephemeral });
}

client.on("ready", () => console.log("Discord bot ready:", client.user.tag));

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "getcoin")
        return handleGetcoinCmd(interaction);
      if (interaction.commandName === "checkcoin")
        return handleCheckcoin(interaction, true);
    } else if (interaction.isButton()) {
      const [scope, platform] = interaction.customId.split(":");
      if (scope === "getcoin") return handleGetcoinClick(interaction, platform);
    }
  } catch (e) {
    console.error("Interaction error", e);
    try {
      if (!interaction.replied)
        await interaction.reply({ content: "Lỗi, thử lại", ephemeral: true });
    } catch {}
  }
});

// -------- Web routes (admin simple + claim) ----------
app.get("/", (_req, res) => res.send("Discord Coin Suite is running."));

app.get("/admin", (req, res) => {
  // simple auth: either ADMIN_SECRET or whitelist id (as query to view)
  const secret = req.query.secret || "";
  const adminSecret = process.env.ADMIN_SECRET || "";
  if (secret === adminSecret) {
    return res.render("admin", { msg: null });
  }
  // show login form: ask for secret
  return res.render("admin_login", { msg: null });
});

app.post("/admin/do", (req, res) => {
  const { secret, user_id, coin_type, amount } = req.body;
  if (secret !== (process.env.ADMIN_SECRET || ""))
    return res.status(403).send("Forbidden");
  if (!user_id || !coin_type) return res.redirect("/admin");
  const n = parseInt(amount || "0", 10);
  if (coin_type === "normal") {
    const current = getUser(user_id).normal_coin || 0;
    setNormalCoin(user_id, Math.max(0, current + n));
  } else {
    const current = getUser(user_id).vip_coin || 0;
    setVipCoin(user_id, Math.max(0, current + n));
  }
  return res.render("admin", { msg: `Đã cập nhật ${user_id}` });
});

// Claim endpoint — link redirect here after user vượt link
app.get("/claim", (req, res) => {
  const { platform, subid, uid } = req.query;
  if (!platform || !subid || !uid) return res.status(400).send("Thiếu tham số.");
  const date = todayStr();
  const entry = getDailyLink(uid, date, platform);
  const claim = getClaimBySubid(subid);
  if (!entry || !claim) return res.status(400).send("Link không hợp lệ hoặc đã hết hạn.");
  const ip = (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    ""
  )
    .toString()
    .split(",")[0]
    .trim();
  if (hasAwardedOnIP(ip, date, platform))
    return res.status(429).send("IP này đã claim hôm nay cho platform này.");
  const counts = countAwardedTodayByPlatform(uid, date);
  if ((counts[platform] || 0) >= (PLATFORM_LIMITS[platform] || 0))
    return res.status(429).send("Hết lượt hôm nay.");
  if (claim.status !== "awarded") {
    const { total } = computeCoins(platform, new Date());
    addNormalCoin(uid, total);
    markClaimAwarded(claim.id, total, ip);
    // webhook
    if (process.env.DISCORD_WEBHOOK_URL) {
      axios
        .post(process.env.DISCORD_WEBHOOK_URL, {
          content: `✅ <@${uid}> nhận ${total} coin từ ${platform} (IP: ${ip})`,
        })
        .catch(() => {});
    }
    // DM user
    try {
      client.users
        .fetch(uid)
        .then((u) =>
          u
            .send(`Bạn vừa nhận ${total} coin từ ${platform}`)
            .catch(() => {})
        )
        .catch(() => {});
    } catch {}
  }
  return res.sendFile(path.join(__dirname, "views", "claimed.html"));
});

// admin logs view
app.get("/admin/logs", (req, res) => {
  const q = {
    user_id: req.query.user_id || "",
    platform: req.query.platform || "",
    status: req.query.status || "",
    from: req.query.from || "",
    to: req.query.to || "",
  };
  let sql =
    "SELECT id,user_id,date,platform,subid,status,coins_awarded,ip,created_at FROM claims WHERE 1=1";
  const args = [];
  if (q.user_id) {
    sql += " AND user_id = ?";
    args.push(q.user_id);
  }
  if (q.platform) {
    sql += " AND platform = ?";
    args.push(q.platform);
  }
  if (q.status) {
    sql += " AND status = ?";
    args.push(q.status);
  }
  if (q.from) {
    sql += " AND date >= ?";
    args.push(q.from);
  }
  if (q.to) {
    sql += " AND date <= ?";
    args.push(q.to);
  }
  sql += " ORDER BY id DESC LIMIT 500";
  const rows = db.prepare(sql).all(...args);
  res.render("admin_logs", { rows, q });
});

// start both
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Web started on", port));
(async () => {
  try {
    await registerCommands();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (e) {
    console.error("Startup error:", e);
  }
})();

// Weekly reset check (per minute)
setInterval(() => {
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const isMonday = dayjs().day() === 1;
    const last = getMeta("last_normal_reset") || "";
    if (isMonday && last !== today) {
      resetAllNormalCoins();
      setMeta("last_normal_reset", today);
      console.log("↻ Weekly reset performed");
    }
  } catch (e) {
    console.error("weekly reset err", e);
  }
}, 60 * 1000);
