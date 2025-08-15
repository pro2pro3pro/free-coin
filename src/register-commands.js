import "dotenv/config";
import { REST } from "discord.js";
import { Routes } from "discord-api-types/v10";
import { SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder().setName("getcoin").setDescription("Nhận link vượt coin (menu 5 phút)").toJSON(),
  new SlashCommandBuilder().setName("checkcoin").setDescription("Xem Normal/VIP coin, tổng tuần/tháng & hệ số").toJSON()
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async ()=> {
  try {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
    console.log("Registered commands");
  } catch(e){ console.error(e); }
})();