require("dotenv").config();

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Display information about this server"),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member permanently or temporarily")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The member to ban")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(false))
    .addStringOption(option =>
      option.setName("duration")
        .setDescription("Duration: 10m, 2h, 7d, 1w (omit for permanent)")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by their Discord ID")
    .addStringOption(option =>
      option.setName("user_id")
        .setDescription("The Discord ID of the banned user")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the unban")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a warning to a member")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The member to warn")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("removewarn")
    .setDescription("Remove the latest warning from a member")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The member whose warning to remove")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("membercase")
    .setDescription("View a member's moderation record")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("The member whose record to view")
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure this server's staff role"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Display all available commands")
].map(command => command.toJSON());

async function main() {
  if (!process.env.DISCORD_TOKEN ||
      !process.env.CLIENT_ID ||
      !process.env.GUILD_ID) {
    throw new Error(
      "DISCORD_TOKEN, CLIENT_ID and GUILD_ID must be configured."
    );
  }

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );

  console.log("Slash commands registered successfully.");
}

main().catch(error => {
  console.error("Command deployment failed:", error);
  process.exitCode = 1;
});
