import "dotenv/config";
import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import crypto from "crypto";
import dayjs from "dayjs";
import { computeCoins } from "./coin.js";
import { shorten } from "./shortener.js";
import { upsertUser, getUser, setDailyLink, getDailyLink, insertClaimGenerated, countAwardedTodayByPlatform, sumCoinsForUserBetween } from "./db.js";
import { getCurrentMultiplier, renderMultiplierTable } from "./multiplier.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});
export function getClient(){ return client; }

const PLATFORM_LIMITS = { yeumoney: 2, link4m: 1, bbmkts: 1 };

function todayStr() { return dayjs().format("YYYY-MM-DD"); }
function monthRange(date=new Date()) {
  const d = dayjs(date);
  const start = d.startOf("month").format("YYYY-MM-DD");
  const end = d.endOf("month").format("YYYY-MM-DD");
  return { start, end };
}
function weekRange(date=new Date()) {
  const d = dayjs(date);
  const day = d.day(); // 0=Sun..6=Sat
  const offset = (day === 0 ? -6 : 1 - day);
  const start = d.add(offset, "day").startOf("day").format("YYYY-MM-DD");
  const end = dayjs(start).add(6, "day").format("YYYY-MM-DD");
  return { start, end };
}
function makeSubId(userId, platform) {
  return `${platform}-${userId}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

async function ensureUserDailyLink(userId, platform) {
  const date = todayStr();
  const exist = getDailyLink(userId, date, platform);
  if (exist) return exist;
  const subid = makeSubId(userId, platform);
  const longBase = process.env.BASE_CLAIM_URL || "http://localhost:3000/claim";
  const longUrl = `${longBase}?platform=${platform}&subid=${encodeURIComponent(subid)}&uid=${userId}`;
  const short = await shorten(platform, longUrl);
  setDailyLink(userId, date, platform, short, subid);
  insertClaimGenerated(userId, date, platform, subid);
  return getDailyLink(userId, date, platform);
}

function remainingField(userId){
  const counts = countAwardedTodayByPlatform(userId, todayStr());
  const remY = Math.max(0, (PLATFORM_LIMITS.yeumoney||0) - (counts.yeumoney||0));
  const remL = Math.max(0, (PLATFORM_LIMITS.link4m||0)  - (counts.link4m||0));
  const remB = Math.max(0, (PLATFORM_LIMITS.bbmkts||0)  - (counts.bbmkts||0));
  return `YeuMoney: **${remY}**\nLink4m: **${remL}**\nBBMKTS: **${remB}**`;
}

function menuEmbed(userId) {
  const m = getCurrentMultiplier();
  const y = computeCoins("yeumoney").total;
  const l = computeCoins("link4m").total;
  const b = computeCoins("bbmkts").total;
  return new EmbedBuilder()
    .setTitle("Vượt link sớm để nhận nhiều coin hơn!")
    .setDescription(`Hệ số nhân hiện tại: **x${m.toFixed(3)}**\nNormal coin reset vào **Thứ 2 hàng tuần**.\nAi cũng có thể bấm trong **5 phút**, mỗi người nhận **link riêng**.`)
    .addFields(
      { name: "YeuMoney (ước tính)", value: `~ ${y} coin`, inline: true },
      { name: "Link4m (ước tính)",  value: `~ ${l} coin`, inline: true },
      { name: "BBMKTS (ước tính)",  value: `~ ${b} coin`, inline: true },
      { name: "Lượt còn lại hôm nay", value: remainingField(userId), inline: false }
    )
    .setColor(0x5865F2)
    .setFooter({ text: "Tip: claim càng sớm càng lời 🕛" });
}

function menuButtons(disabled=false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("getcoin:yeumoney").setLabel("YeuMoney").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("getcoin:link4m").setLabel("Link4m").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("getcoin:bbmkts").setLabel("BBMKTS").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("getcoin:help").setLabel("Xem số coin").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

async function handleGetcoinCmd(interaction) {
  const embed = menuEmbed(interaction.user.id);
  const msg = await interaction.reply({ embeds:[embed], components:[menuButtons(false)], ephemeral:false });
  setTimeout(async()=>{ try{ await msg.edit({ components:[menuButtons(true)] }); }catch{} }, 5*60*1000);
}

function fullEmbed(platform){
  const limitsTxt = {
    yeumoney: "YeuMoney (2 lần/ngày)",
    link4m: "Link4m (1 lần/ngày)",
    bbmkts: "BBMKTS (1 lần/ngày)"
  }[platform] || platform;
  return new EmbedBuilder()
    .setTitle("Hết lượt hôm nay 😵")
    .setDescription(`Bạn đã dùng hết lượt cho **${limitsTxt}**.\nThử lại vào **ngày mai** nha!`)
    .setColor(0xED4245);
}

async function handleGetcoinClick(interaction, platform) {
  if (platform === "help") return handleCheckcoin(interaction, true);
  const userId = interaction.user.id;
  const date = todayStr();
  upsertUser(userId);

  const counts = countAwardedTodayByPlatform(userId, date);
  if ((counts[platform] || 0) >= (PLATFORM_LIMITS[platform] || 0)) {
    return interaction.reply({ embeds:[fullEmbed(platform)], ephemeral:true });
  }

  const entry = await ensureUserDailyLink(userId, platform);
  const { base, multiplier, total } = computeCoins(platform);

  try {
    const dm = await interaction.user.createDM();
    await dm.send({ embeds: [ new EmbedBuilder()
      .setTitle(`Link ${platform} của bạn`)
      .setDescription(`Coin gốc: **${base}**\nHệ số: **x${multiplier.toFixed(3)}**\nNếu claim bây giờ: **~ ${total} coin**\n\n**Link (hết hạn trong ngày):**\n${entry.link}`)
      .setColor(0x2ECC71)
    ]});
  } catch {}

  // Cập nhật lại menu công khai kèm lượt còn lại (cho đẹp)
  try {
    await interaction.message.edit({ embeds: [menuEmbed(userId)], components:[menuButtons(false)] });
  } catch{}

  return interaction.reply({ content: "Mình đã gửi link vào DM của bạn nhé! 🔗", ephemeral: true });
}

async function handleCheckcoin(interaction, ephemeral=true) {
  const userId = interaction.user.id;
  const u = getUser(userId);
  const total = (u.normal_coin||0) + (u.vip_coin||0);
  const m = getCurrentMultiplier();

  const {start: wStart, end: wEnd} = weekRange();
  const {start: mStart, end: mEnd} = monthRange();
  const weekly = sumCoinsForUserBetween(userId, wStart, wEnd);
  const monthly = sumCoinsForUserBetween(userId, mStart, mEnd);

  const summary = new EmbedBuilder()
    .setTitle("Thông tin coin của bạn")
    .setDescription("**Normal coin** reset vào 00:00 **Thứ 2** hàng tuần. **VIP coin** không reset (admin cộng).\nVượt link sớm để nhận nhiều coin hơn!")
    .addFields(
      { name:"Bạn còn (Normal+VIP)", value:`${total} coin`, inline:true },
      { name:"Normal coin", value:`${u.normal_coin}`, inline:true },
      { name:"VIP coin", value:`${u.vip_coin}`, inline:true },
      { name:"Hệ số hiện tại", value:`x${m.toFixed(3)}`, inline:true },
      { name:"Tổng tuần", value:`${weekly} coin`, inline:true },
      { name:"Tổng tháng", value:`${monthly} coin`, inline:true }
    )
    .setColor(0xFFC300);

  const table = "```" + renderMultiplierTable() + "```";

  return interaction.reply({ embeds:[summary], content: table, ephemeral });
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("getcoin").setDescription("Nhận link vượt coin (menu 5 phút)"),
    new SlashCommandBuilder().setName("checkcoin").setDescription("Xem Normal/VIP coin, tổng tuần/tháng & hệ số")
  ].map(c=>c.toJSON());
  const rest = new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log("✔ Slash commands registered");
}

client.on("ready", ()=> console.log(`Logged in as ${client.user.tag}`));

client.on("interactionCreate", async (interaction)=>{
  try{
    if (interaction.isChatInputCommand()){
      if (interaction.commandName==="getcoin")  return handleGetcoinCmd(interaction);
      if (interaction.commandName==="checkcoin") return handleCheckcoin(interaction,true);
    } else if (interaction.isButton()){
      const [scope, platform] = interaction.customId.split(":");
      if (scope==="getcoin") return handleGetcoinClick(interaction, platform);
    }
  } catch(e) {
    console.error(e);
    try{ await interaction.reply({content:"Có lỗi xảy ra.", ephemeral:true}); }catch{}
  }
});

export async function startBot(){
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
}