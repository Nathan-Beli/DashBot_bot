const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder,
    ActionRowBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');

// Small web server to keep the bot alive on cloud hosts
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('* Bot Online *');
});

app.listen(PORT, () => {
    console.log(`[WEB] Server is running on port ${PORT}`);
});

// Replace with your bot's real token in the Developer Portal
const TOKEN = process.env.DISCORD_TOKEN || 'YOUR_DISCORD_TOKEN_HERE';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans
    ]
});

// In-memory storage for staff roles and warnings
const staffRoles = new Map(); // guildId -> roleId
const warnings = new Map();   // guildId-userId -> Array

// --- SLASH COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Displays detailed information about the server'),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption(opt => opt.setName('user').setDescription('The user to ban').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the ban').setRequired(false))
        .addIntegerOption(opt => opt.setName('duration').setDescription('Ban duration in days').setRequired(false)),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(opt => opt.setName('userid').setDescription('The ID of the user to unban').setRequired(true)),

    new SlashCommandBuilder()
        .setName('warnmember')
        .setDescription('Warn a member')
        .addUserOption(opt => opt.setName('user').setDescription('The member to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(false)),

    new SlashCommandBuilder()
        .setName('removewarning')
        .setDescription('Remove a warning from a member')
        .addUserOption(opt => opt.setName('user').setDescription('The member concerned').setRequired(true))
        .addIntegerOption(opt => opt.setName('index').setDescription('The warning index to remove (1, 2, etc.)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('memberfile')
        .setDescription('View a member\'s warning file')
        .addUserOption(opt => opt.setName('user').setDescription('The member to view').setRequired(false)),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Open the configuration panel (Server Owner only)'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays all available bot commands')
].map(cmd => cmd.toJSON());

// --- COMMAND REGISTRATION ---
client.once('ready', async () => {
    console.log(`[BOT] Logged in as ${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('[BOT] Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('[BOT] Slash commands registered successfully!');
    } catch (error) {
        console.error('[BOT] Error registering slash commands:', error);
    }
});

// Helper function: Strict Staff Role Check
function isStaff(member) {
    const staffRoleId = staffRoles.get(member.guild.id);
    if (!staffRoleId) return false;
    return member.roles.cache.has(staffRoleId);
}

// --- INTERACTION HANDLING ---
client.on('interactionCreate', async interaction => {
    // 1. Handling Role Select Menu Interaction
    if (interaction.isRoleSelectMenu()) {
        if (interaction.customId === 'select_staff_role') {
            if (interaction.guild.ownerId !== interaction.user.id) {
                return interaction.reply({ 
                    content: '❌ **Access Denied:** Only the Server Owner can configure this.', 
                    ephemeral: true 
                });
            }

            const selectedRoleId = interaction.values[0];
            staffRoles.set(interaction.guild.id, selectedRoleId);

            const updatedEmbed = new EmbedBuilder()
                .setColor(0x23A55A)
                .setTitle('⚙️ DashBot Control Panel')
                .setDescription(`✅ **Success:** The Staff role has been updated to <@&${selectedRoleId}>.\n\nHere are the available features:`)
                .addFields(
                    { name: '🛡️ Staff Role', value: `<@&${selectedRoleId}>`, inline: true },
                    { name: '🔮 Upcoming Features', value: '*More modules coming soon...*', inline: true }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_config_staff')
                    .setLabel('Change Staff Role')
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.update({ embeds: [updatedEmbed], components: [row] });
        }
    }

    // 2. Handling Button Interaction for /setup panel
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_config_staff') {
            if (interaction.guild.ownerId !== interaction.user.id) {
                return interaction.reply({ 
                    content: '❌ **Access Denied:** Only the Server Owner can configure this.', 
                    ephemeral: true 
                });
            }

            const roleSelect = new RoleSelectMenuBuilder()
                .setCustomId('select_staff_role')
                .setPlaceholder('Select the Staff role...')
                .setMinValues(1)
                .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(roleSelect);

            return interaction.reply({
                content: 'Please select the new Staff role below:',
                components: [row],
                ephemeral: true
            });
        }
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild, member, options } = interaction;

    // 1. /SETUP (Server Owner Only)
    if (commandName === 'setup') {
        if (guild.ownerId !== member.id) {
            return interaction.reply({ 
                content: '❌ **Access Denied:** Only the Server Owner can use this command.', 
                ephemeral: true 
            });
        }

        const currentRoleId = staffRoles.get(guild.id);
        const staffRoleDisplay = currentRoleId ? `<@&${currentRoleId}>` : '❌ *Not configured*';

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('⚙️ DashBot Control Panel')
            .setDescription('Welcome to your server control panel. Use the buttons below to manage bot features.')
            .addFields(
                { name: '🛡️ Current Staff Role', value: staffRoleDisplay, inline: true },
                { name: '🔮 Upcoming Features', value: 'More options and modules will be added here soon.', inline: false }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_config_staff')
                .setLabel('Configure Staff Role')
                .setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true
        });
    }

    // 2. /HELP (Accessible to everyone)
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📖 DashBot Command List')
            .setDescription('Here are all available commands:')
            .addFields(
                { name: '/serverinfo', value: 'Displays detailed information about the server.' },
                { name: '/ban [user] (reason) (duration)', value: 'Bans a user from the server. *(Staff Role Required - Ephemeral)*' },
                { name: '/unban [userid]', value: 'Unbans a user using their User ID. *(Staff Role Required - Ephemeral)*' },
                { name: '/warnmember [user] (reason)', value: 'Warns a server member. *(Staff Role Required - Ephemeral)*' },
                { name: '/removewarning [user] (index)', value: 'Removes a warning from a member. *(Staff Role Required - Ephemeral)*' },
                { name: '/memberfile (user)', value: 'View warnings for a member. *(Staff Role Required - Ephemeral)*' },
                { name: '/setup', value: 'Opens the control panel. *(Server Owner Only - Ephemeral)*' },
                { name: '/help', value: 'Displays this command list.' }
            );

        return interaction.reply({ embeds: [embed] });
    }

    // 3. /SERVERINFO (Accessible to everyone)
    if (commandName === 'serverinfo') {
        await guild.members.fetch();
        
        const totalMembers = guild.memberCount;
        const botCount = guild.members.cache.filter(m => m.user.bot).size;
        const humanCount = totalMembers - botCount;
        const channelCount = guild.channels.cache.size;
        const owner = await guild.fetchOwner();
        const iconUrl = guild.iconURL({ dynamic: true, size: 1024 });

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`Server Info - ${guild.name}`)
            .setThumbnail(iconUrl)
            .addFields(
                { name: '👑 Owner', value: `${owner.user.tag}`, inline: true },
                { name: '📅 Created On', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '💬 Total Channels', value: `${channelCount}`, inline: true },
                { name: '👥 Members', value: `Total: **${totalMembers}**\nHumans: **${humanCount}**\nBots: **${botCount}**`, inline: true }
            );

        return interaction.reply({ embeds: [embed] });
    }

    // --- STRICT STAFF ROLE CHECK FOR MODERATION COMMANDS ---
    if (!isStaff(member)) {
        return interaction.reply({ 
            content: '❌ **Access Denied:** You must have the configured **Staff role** to use this command, even if you have administrator permissions.', 
            ephemeral: true 
        });
    }

    // 4. /BAN
    if (commandName === 'ban') {
        const targetUser = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const duration = options.getInteger('duration');

        try {
            await guild.members.ban(targetUser, { reason });
            let message = `Successfully banned **${targetUser.tag}** | Reason: *${reason}*`;
            if (duration) message += ` | Duration: *${duration} day(s)*`;

            return interaction.reply({ content: `✅ ${message}`, ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: `❌ Failed to ban user: ${err.message}`, ephemeral: true });
        }
    }

    // 5. /UNBAN
    if (commandName === 'unban') {
        const userId = options.getString('userid');

        try {
            await guild.bans.remove(userId, 'Unbanned via moderation command');
            return interaction.reply({ content: `✅ Successfully unbanned user ID: **${userId}**`, ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: `❌ Failed to unban user. Make sure the ID is correct and the user is banned.`, ephemeral: true });
        }
    }

    // 6. /WARNMEMBER
    if (commandName === 'warnmember') {
        const targetUser = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const key = `${guild.id}-${targetUser.id}`;

        if (!warnings.has(key)) warnings.set(key, []);
        warnings.get(key).push({ reason, date: new Date().toLocaleDateString(), staff: member.user.tag });

        return interaction.reply({ content: `⚠️ **${targetUser.tag}** has been warned. | Reason: *${reason}*`, ephemeral: true });
    }

    // 7. /REMOVEWARNING
    if (commandName === 'removewarning') {
        const targetUser = options.getUser('user');
        const index = options.getInteger('index');
        const key = `${guild.id}-${targetUser.id}`;

        const userWarns = warnings.get(key) || [];
        if (userWarns.length === 0) {
            return interaction.reply({ content: `ℹ️ **${targetUser.tag}** has no active warnings.`, ephemeral: true });
        }

        if (index) {
            if (index < 1 || index > userWarns.length) {
                return interaction.reply({ content: `❌ Invalid index. Member has ${userWarns.length} warning(s).`, ephemeral: true });
            }
            userWarns.splice(index - 1, 1);
        } else {
            userWarns.pop();
        }

        return interaction.reply({ content: `✅ Warning removed for **${targetUser.tag}**. Remaining: **${userWarns.length}**`, ephemeral: true });
    }

    // 8. /MEMBERFILE
    if (commandName === 'memberfile') {
        const targetUser = options.getUser('user') || interaction.user;
        const key = `${guild.id}-${targetUser.id}`;
        const userWarns = warnings.get(key) || [];

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📁 Member File - ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User ID', value: targetUser.id, inline: true },
                { name: 'Total Warnings', value: `${userWarns.length}`, inline: true }
            );

        if (userWarns.length > 0) {
            const warnList = userWarns.map((w, i) => `**#${i + 1}** - *${w.reason}* (By: ${w.staff} on ${w.date})`).join('\n');
            embed.addFields({ name: 'Warning History', value: warnList });
        } else {
            embed.addFields({ name: 'Warning History', value: 'Clean record. No warnings found.' });
        }

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Bot Login
client.login(TOKEN);
