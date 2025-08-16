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

// ========== Express setup ==========
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

// ========== Discord Bot ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});
export function getClient() {
  return client;
}

// ========== Register Slash Commands ==========
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("getcoin")
      .setDescription("Nhận link vượt coin (menu 5 phút)"),
    new SlashCommandBuilder()
      .setName("checkcoin")
      .setDescription("Xem Normal/VIP coin, tổng tuần/tháng và hệ số"),
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

// ========== Interaction Handlers ==========
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  await upsertUser(userId);

  if (interaction.commandName === "getcoin") {
    const multiplier = getCurrentMultiplier();
    const base = 150;
    const coin = Math.round(computeCoins(base, multiplier));

    const embed = new EmbedBuilder()
      .setTitle("🚀 Menu vượt link nhận coin")
      .setDescription(
        `Bạn sẽ nhận **${coin} Normal Coin** (x${multiplier.toFixed(
          3
        )})\n\n💡 Vượt link sớm để nhận nhiều coin hơn!`
      )
      .setColor(0x00ae86)
      .setFooter({ text: "Menu sẽ hết hạn sau 5 phút" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Link bbmkts")
        .setStyle(ButtonStyle.Link)
        .setURL(
          await shorten(
            "bbmkts",
            `https://example.com/claim?uid=${userId}&p=bbmkts`
          )
        ),
      new ButtonBuilder()
        .setLabel("Link4m")
        .setStyle(ButtonStyle.Link)
        .setURL(
          await shorten(
            "link4m",
            `https://example.com/claim?uid=${userId}&p=link4m`
          )
        ),
      new ButtonBuilder()
        .setLabel("YeuMoney")
        .setStyle(ButtonStyle.Link)
        .setURL(
          await shorten(
            "yeumoney",
            `https://example.com/claim?uid=${userId}&p=yeumoney`
          )
        )
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  if (interaction.commandName === "checkcoin") {
    const user = getUser(userId);
    const normal = user?.normal_coin || 0;
    const vip = user?.vip_coin || 0;

    const now = dayjs();
    const weekStart = now.startOf("week").toDate();
    const monthStart = now.startOf("month").toDate();
    const weekly = sumCoinsForUserBetween(userId, weekStart, now.toDate());
    const monthly = sumCoinsForUserBetween(userId, monthStart, now.toDate());

    const embed1 = new EmbedBuilder()
      .setTitle("💰 Coin của bạn")
      .addFields(
        { name: "Normal Coin", value: `${normal}`, inline: true },
        { name: "VIP Coin", value: `${vip}`, inline: true },
        { name: "Tổng tuần", value: `${weekly}`, inline: true },
        { name: "Tổng tháng", value: `${monthly}`, inline: true }
      )
      .setColor(0xf1c40f);

    const embed2 = new EmbedBuilder()
      .setTitle("⏰ Giờ nhận coin nhiều hơn")
      .setDescription(renderMultiplierTable())
      .setColor(0x3498db);

    await interaction.reply({ embeds: [embed1, embed2], ephemeral: true });
  }
});

// ========== Express Routes ==========
app.get("/", (req, res) => {
  res.send("Discord Coin Bot + Web chạy rồi 🚀");
});

// ========== Start server & bot ==========
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

// ========== Weekly Reset ==========
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
