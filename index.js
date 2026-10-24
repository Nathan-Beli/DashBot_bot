require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  PermissionFlagsBits
} = require("discord.js");

if (!process.env.DISCORD_TOKEN) {
  throw new Error("Missing DISCORD_TOKEN in .env");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

// Persistent JSON storage.
// Use persistent disk storage when deploying the bot.
const dataDirectory = path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "database.json");

fs.mkdirSync(dataDirectory, { recursive: true });

function loadDatabase() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return { guilds: {}, temporaryBans: [] };
  }
}

let database = loadDatabase();

function saveDatabase() {
  const temporaryFile = `${dataFile}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(database, null, 2)
  );

  fs.renameSync(temporaryFile, dataFile);
}

function getGuildData(guildId) {
  if (!database.guilds[guildId]) {
    database.guilds[guildId] = {
      staffRoleId: null,
      warnings: {}
    };
  }

  return database.guilds[guildId];
}

function makeEmbed(title, description, color = 0x5865F2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

async function replyPrivate(interaction, content) {
  const payload = {
    content,
    ephemeral: true
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

// Every moderation command checks the configured role.
// Discord administrator permissions do NOT bypass this check.
function hasStaffRole(interaction) {
  if (!interaction.guild || !interaction.member) {
    return false;
  }

  const config = getGuildData(interaction.guild.id);
  const roleId = config.staffRoleId;

  if (!roleId) return false;

  const member = interaction.member;

  return Boolean(
    member.roles &&
    member.roles.cache &&
    member.roles.cache.has(roleId)
  );
}

function parseDuration(input) {
  if (!input) return null;

  const match = input.trim().match(
    /^(\d+)\s*(m|h|d|w)$/i
  );

  if (!match) {
    throw new Error(
      "Invalid duration. Use formats such as 10m, 2h, 7d or 1w."
    );
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error("Duration must be a positive whole number.");
  }

  const multipliers = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000
  };

  const duration = amount * multipliers[unit];

  if (!Number.isSafeInteger(duration) ||
      duration > 365 * 86_400_000) {
    throw new Error("Maximum temporary ban duration is 365 days.");
  }

  return duration;
}

function getWarnings(guildId, userId) {
  const guildData = getGuildData(guildId);

  if (!guildData.warnings[userId]) {
    guildData.warnings[userId] = [];
  }

  return guildData.warnings[userId];
}

async function handleServerInfo(interaction) {
  const guild = interaction.guild;

  await guild.fetch();
  const owner = await guild.fetchOwner();

  let members;

  try {
    members = await guild.members.fetch();
  } catch {
    members = guild.members.cache;
  }

  const botCount = members.filter(member => member.user.bot).size;
  const humanCount = members.filter(member => !member.user.bot).size;

  const textChannels = guild.channels.cache.filter(
    channel => channel.type === 0
  ).size;

  const voiceChannels = guild.channels.cache.filter(
    channel => channel.type === 2
  ).size;

  const categoryChannels = guild.channels.cache.filter(
    channel => channel.type === 4
  ).size;

  const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${guild.name} — Server Information`)
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      {
        name: "General",
        value:
          `**Server ID:** ${guild.id}\n` +
          `**Owner:** ${owner.user.tag}\n` +
          `**Created:** <t:${createdTimestamp}:F>\n` +
          `**Verification Level:** ${guild.verificationLevel}`,
        inline: false
      },
      {
        name: "Members",
        value:
          `**Total:** ${guild.memberCount}\n` +
          `**Humans:** ${humanCount}\n` +
          `**Bots:** ${botCount}`,
        inline: true
      },
      {
        name: "Channels",
        value:
          `**Total:** ${guild.channels.cache.size}\n` +
          `**Text:** ${textChannels}\n` +
          `**Voice:** ${voiceChannels}\n` +
          `**Categories:** ${categoryChannels}`,
        inline: true
      },
      {
        name: "Other",
        value:
          `**Roles:** ${guild.roles.cache.size}\n` +
          `**Emojis:** ${guild.emojis.cache.size}\n` +
          `**Boost Level:** ${guild.premiumTier}`,
        inline: true
      }
    )
    .setFooter({ text: "Server Information" })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: false
  });
}

async function handleBan(interaction) {
  const guild = interaction.guild;
  const user = interaction.options.getUser("user");
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const durationInput = interaction.options.getString("duration");

  if (user.id === interaction.user.id) {
    return replyPrivate(interaction, "You cannot ban yourself.");
  }

  if (user.id === client.user.id) {
    return replyPrivate(interaction, "You cannot ban the bot itself.");
  }

  let duration;

  try {
    duration = parseDuration(durationInput);
  } catch (error) {
    return replyPrivate(interaction, error.message);
  }

  const targetMember = await guild.members
    .fetch(user.id)
    .catch(() => null);

  if (targetMember) {
    if (targetMember.id === guild.ownerId) {
      return replyPrivate(interaction, "The server owner cannot be banned.");
    }

    if (
      targetMember.roles.highest.position >=
      interaction.member.roles.highest.position &&
      guild.ownerId !== interaction.user.id
    ) {
      return replyPrivate(
        interaction,
        "You cannot ban a member with an equal or higher role."
      );
    }

    const botMember = guild.members.me;

    if (
      botMember &&
      targetMember.roles.highest.position >=
      botMember.roles.highest.position
    ) {
      return replyPrivate(
        interaction,
        "I cannot ban this member because their highest role is too high."
      );
    }
  }

  try {
    await guild.members.ban(user.id, {
      reason: `${reason} | Moderator: ${interaction.user.tag}`
    });

    if (duration) {
      database.temporaryBans = database.temporaryBans.filter(
        entry =>
          !(entry.guildId === guild.id && entry.userId === user.id)
      );

      database.temporaryBans.push({
        guildId: guild.id,
        userId: user.id,
        expiresAt: Date.now() + duration,
        reason
      });

      saveDatabase();
    }

    const durationText = durationInput
      ? `Temporary (${durationInput})`
      : "Permanent";

    return replyPrivate(
      interaction,
      `**Ban successful**\n` +
      `User: ${user.tag} (\`${user.id}\`)\n` +
      `Type: ${durationText}\n` +
      `Reason: ${reason}`
    );
  } catch (error) {
    console.error("Ban error:", error);

    return replyPrivate(
      interaction,
      "The ban failed. Check my Ban Members permission and role hierarchy."
    );
  }
}

async function handleUnban(interaction) {
  const guild = interaction.guild;
  const userId = interaction.options.getString("user_id").trim();
  const reason =
    interaction.options.getString("reason") || "No reason provided";

  if (!/^\d{17,20}$/.test(userId)) {
    return replyPrivate(interaction, "Please provide a valid Discord user ID.");
  }

  try {
    await guild.bans.remove(userId, reason);

    database.temporaryBans = database.temporaryBans.filter(
      entry =>
        !(entry.guildId === guild.id && entry.userId === userId)
    );

    saveDatabase();

    return replyPrivate(
      interaction,
      `**Unban successful**\nUser ID: \`${userId}\`\nReason: ${reason}`
    );
  } catch (error) {
    console.error("Unban error:", error);

    return replyPrivate(
      interaction,
      "Could not unban this user. Check the user ID and my permissions."
    );
  }
}

async function handleWarn(interaction) {
  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason");

  if (user.bot) {
    return replyPrivate(interaction, "You cannot warn a bot.");
  }

  if (user.id === interaction.user.id) {
    return replyPrivate(interaction, "You cannot warn yourself.");
  }

  const warnings = getWarnings(interaction.guild.id, user.id);

  const warning = {
    id: `${Date.now()}`,
    reason,
    moderatorId: interaction.user.id,
    createdAt: new Date().toISOString()
  };

  warnings.push(warning);
  saveDatabase();

  try {
    await user.send({
      embeds: [
        makeEmbed(
          "You have received a warning",
          `**Server:** ${interaction.guild.name}\n` +
          `**Reason:** ${reason}`,
          0xFEE75C
        )
      ]
    });
  } catch {
    // The user may have DMs disabled.
  }

  return replyPrivate(
    interaction,
    `**Warning issued**\n` +
    `User: ${user.tag}\n` +
    `Warning ID: \`${warning.id}\`\n` +
    `Reason: ${reason}\n` +
    `Total warnings: ${warnings.length}`
  );
}

async function handleRemoveWarn(interaction) {
  const user = interaction.options.getUser("user");
  const warnings = getWarnings(interaction.guild.id, user.id);

  if (!warnings.length) {
    return replyPrivate(interaction, "This member has no warnings to remove.");
  }

  const removed = warnings.pop();
  saveDatabase();

  return replyPrivate(
    interaction,
    `Removed the latest warning from **${user.tag}**.\n` +
    `Warning ID: \`${removed.id}\`\n` +
    `Remaining warnings: ${warnings.length}`
  );
}

async function handleMemberCase(interaction) {
  const user = interaction.options.getUser("user");
  const warnings = getWarnings(interaction.guild.id, user.id);

  const embed = makeEmbed(
    `Moderation Record — ${user.tag}`,
    `**User ID:** ${user.id}\n` +
    `**Total warnings:** ${warnings.length}`,
    0x5865F2
  ).setThumbnail(user.displayAvatarURL({ size: 256 }));

  if (!warnings.length) {
    embed.addFields({
      name: "Warnings",
      value: "No warnings recorded."
    });
  } else {
    for (const warning of warnings.slice(-10).reverse()) {
      const timestamp = Math.floor(
        new Date(warning.createdAt).getTime() / 1000
      );

      embed.addFields({
        name: `Warning ${warning.id}`,
        value:
          `**Reason:** ${warning.reason}\n` +
          `**Moderator:** <@${warning.moderatorId}>\n` +
          `**Date:** <t:${timestamp}:F>`,
        inline: false
      });
    }
  }

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}

async function handleSetup(interaction) {
  const owner = await interaction.guild.fetchOwner();

  if (owner.id !== interaction.user.id) {
    return replyPrivate(
      interaction,
      "Only the server owner can configure the bot."
    );
  }

  const button = new ButtonBuilder()
    .setCustomId("setup_choose_staff")
    .setLabel("Choose Staff Role")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  const config = getGuildData(interaction.guild.id);
  const currentRole = config.staffRoleId
    ? `<@&${config.staffRoleId}>`
    : "Not configured";

  const embed = makeEmbed(
    "Bot Setup",
    `**Staff Role:** ${currentRole}\n\n` +
    "Click the button below to select the role authorized to use moderation commands."
  );

  return interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
}

async function handleHelp(interaction) {
  const embed = makeEmbed(
    "Bot Commands",
    "Here are the available commands."
  ).addFields(
    {
      name: "General",
      value:
        "`/serverinfo` — View server information\n" +
        "`/help` — Display this help menu"
    },
    {
      name: "Moderation (Staff only)",
      value:
        "`/ban user [reason] [duration]` — Ban a member\n" +
        "`/unban user_id [reason]` — Unban a user\n" +
        "`/warn user reason` — Issue a warning\n" +
        "`/removewarn user` — Remove the latest warning\n" +
        "`/membercase user` — View a moderation record"
    },
    {
      name: "Configuration",
      value: "`/setup` — Configure the Staff role (server owner only)"
    }
  );

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}

// Automatically process expired temporary bans.
async function processTemporaryBans() {
  const now = Date.now();
  const expired = database.temporaryBans.filter(
    entry => entry.expiresAt <= now
  );

  if (!expired.length) return;

  for (const entry of expired) {
    const guild = client.guilds.cache.get(entry.guildId);

    if (!guild) continue;

    try {
      await guild.bans.remove(
        entry.userId,
        "Temporary ban expired"
      );
    } catch (error) {
      // If already unbanned, the entry can still be removed.
      if (error.code !== 10026) {
        console.error(
          `Could not expire ban for ${entry.userId}:`,
          error.message
        );
      }
    }

    database.temporaryBans = database.temporaryBans.filter(
      item =>
        !(item.guildId === entry.guildId &&
          item.userId === entry.userId)
    );

    saveDatabase();
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await processTemporaryBans();

  setInterval(() => {
    processTemporaryBans().catch(console.error);
  }, 30_000);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = interaction.commandName;

      if (command === "help") {
        return await handleHelp(interaction);
      }

      if (command === "serverinfo") {
        return await handleServerInfo(interaction);
      }

      if (command === "setup") {
        return await handleSetup(interaction);
      }

      const staffCommands = [
        "ban",
        "unban",
        "warn",
        "removewarn",
        "membercase"
      ];

      if (staffCommands.includes(command)) {
        if (!hasStaffRole(interaction)) {
          return await replyPrivate(
            interaction,
            "You are not authorized to use this command. The configured Staff role is required."
          );
        }

        if (!interaction.memberPermissions?.has(
          PermissionFlagsBits.BanMembers
        ) && ["ban", "unban"].includes(command)) {
          return await replyPrivate(
            interaction,
            "You also need the Discord Ban Members permission to use this command."
          );
        }

        if (command === "ban") {
          return await handleBan(interaction);
        }

        if (command === "unban") {
          return await handleUnban(interaction);
        }

        if (command === "warn") {
          return await handleWarn(interaction);
        }

        if (command === "removewarn") {
          return await handleRemoveWarn(interaction);
        }

        if (command === "membercase") {
          return await handleMemberCase(interaction);
        }
      }
    }

    if (interaction.isButton() &&
        interaction.customId === "setup_choose_staff") {
      const owner = await interaction.guild.fetchOwner();

      if (owner.id !== interaction.user.id) {
        return replyPrivate(
          interaction,
          "Only the server owner can configure the bot."
        );
      }

      const selector = new RoleSelectMenuBuilder()
        .setCustomId("setup_staff_role_select")
        .setPlaceholder("Select the Staff role")
        .setMinValues(1)
        .setMaxValues(1);

      return interaction.reply({
        content: "Select the role authorized to use moderation commands:",
        components: [
          new ActionRowBuilder().addComponents(selector)
        ],
        ephemeral: true
      });
    }

    if (interaction.isRoleSelectMenu() &&
        interaction.customId === "setup_staff_role_select") {
      const owner = await interaction.guild.fetchOwner();

      if (owner.id !== interaction.user.id) {
        return replyPrivate(
          interaction,
          "Only the server owner can configure the bot."
        );
      }

      const role = interaction.roles.first();

      if (!role || role.id === interaction.guild.id) {
        return replyPrivate(
          interaction,
          "Please select a valid Staff role."
        );
      }

      const config = getGuildData(interaction.guild.id);
      config.staffRoleId = role.id;
      saveDatabase();

      return interaction.update({
        content: `Staff role configured successfully: ${role}`,
        components: []
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      await replyPrivate(
        interaction,
        "An unexpected error occurred. Please check the bot logs."
      ).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
