const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder 
} = require('discord.js');

// Remplace par le vrai token de ton bot dans le Developer Portal
const TOKEN = process.env.DISCORD_TOKEN || 'TON_TOKEN_DISCORD_ICI';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans
    ]
});

// Stockage en mémoire du rôle staff et des avertissements
const staffRoles = new Map(); // guildId -> roleId
const warnings = new Map();   // guildId-userId -> Array

// --- DÉFINITION DES COMMANDES SLASH ---
const commands = [
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Displays information about the current server'),

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
        .setName('warn')
        .setDescription('Warn a member')
        .addUserOption(opt => opt.setName('user').setDescription('The member to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(false)),

    new SlashCommandBuilder()
        .setName('removewarn')
        .setDescription('Remove a warning from a member')
        .addUserOption(opt => opt.setName('user').setDescription('The member to remove warning from').setRequired(true))
        .addIntegerOption(opt => opt.setName('index').setDescription('The warning index to remove (1, 2, etc.)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('memberfile')
        .setDescription('View a member\'s warning file')
        .addUserOption(opt => opt.setName('user').setDescription('The member to view').setRequired(false)),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure the Staff role for bot commands (Server Owner only)')
        .addRoleOption(opt => opt.setName('role').setDescription('The staff role').setRequired(true)),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays all available bot commands')
].map(cmd => cmd.toJSON());

// --- ENREGISTREMENT DES COMMANDES ---
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

// Fonction utilitaire : vérification stricte du rôle Staff
function isStaff(member) {
    const staffRoleId = staffRoles.get(member.guild.id);
    if (!staffRoleId) return false;
    return member.roles.cache.has(staffRoleId);
}

// --- GESTION DES INTERACTIONS ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guild, member, options } = interaction;

    // 1. /SETUP (Uniquement pour le fondateur / Owner)
    if (commandName === 'setup') {
        if (guild.ownerId !== member.id) {
            return interaction.reply({ 
                content: '❌ **Access Denied:** Only the Server Owner can use this command.', 
                ephemeral: true 
            });
        }

        const role = options.getRole('role');
        staffRoles.set(guild.id, role.id);

        const embed = new EmbedBuilder()
            .setColor(0x23A55A)
            .setTitle('⚙️ Setup Complete')
            .setDescription(`The Staff role has been set to ${role}. Members with this role can now use staff commands.`);

        return interaction.reply({ embeds: [embed] });
    }

    // 2. /HELP (Accessible à tous)
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('📖 DashBot Command List')
            .setDescription('Here are all available commands:')
            .addFields(
                { name: '/serverinfo', value: 'Displays detailed information about the server.' },
                { name: '/ban [user] (reason) (duration)', value: 'Bans a user from the server. *(Staff Role Required)*' },
                { name: '/unban [userid]', value: 'Unbans a user using their User ID. *(Staff Role Required)*' },
                { name: '/warn [user] (reason)', value: 'Warns a server member. *(Staff Role Required)*' },
                { name: '/removewarn [user] (index)', value: 'Removes a warning from a member. *(Staff Role Required)*' },
                { name: '/memberfile (user)', value: 'View warnings for a member. *(Staff Role Required)*' },
                { name: '/setup [role]', value: 'Configure the Staff role. *(Server Owner Only)*' },
                { name: '/help', value: 'Displays this command list.' }
            );

        return interaction.reply({ embeds: [embed] });
    }

    // 3. /SERVERINFO (Accessible à tous)
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

    // --- VÉRIFICATION STRICTE DU RÔLE STAFF POUR LES COMMANDES DE MODÉRATION ---
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

            return interaction.reply({ content: `✅ ${message}` });
        } catch (err) {
            return interaction.reply({ content: `❌ Failed to ban user: ${err.message}`, ephemeral: true });
        }
    }

    // 5. /UNBAN
    if (commandName === 'unban') {
        const userId = options.getString('userid');

        try {
            await guild.members.unban(userId);
            return interaction.reply({ content: `✅ Successfully unbanned user ID: **${userId}**` });
        } catch (err) {
            return interaction.reply({ content: `❌ Failed to unban user. Make sure the ID is correct.`, ephemeral: true });
        }
    }

    // 6. /WARN
    if (commandName === 'warn') {
        const targetUser = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const key = `${guild.id}-${targetUser.id}`;

        if (!warnings.has(key)) warnings.set(key, []);
        warnings.get(key).push({ reason, date: new Date().toLocaleDateString(), staff: member.user.tag });

        return interaction.reply({ content: `⚠️ **${targetUser.tag}** has been warned. | Reason: *${reason}*` });
    }

    // 7. /REMOVEWARN
    if (commandName === 'removewarn') {
        const targetUser = options.getUser('user');
        const index = options.getInteger('index');
        const key = `${guild.id}-${targetUser.id}`;

        const userWarns = warnings.get(key) || [];
        if (userWarns.length === 0) {
            return interaction.reply({ content: `ℹ️ **${targetUser.tag}** has no active warnings.`, ephemeral: true });
        }

        if (index) {
            if (index < 1 || index > userWarns.length) {
                return interaction.reply({ content: `❌ Invalid index. User has ${userWarns.length} warning(s).`, ephemeral: true });
            }
            userWarns.splice(index - 1, 1);
        } else {
            userWarns.pop();
        }

        return interaction.reply({ content: `✅ Removed warning from **${targetUser.tag}**. Remaining: **${userWarns.length}**` });
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

        return interaction.reply({ embeds: [embed] });
    }
});

// Connexion du bot
client.login(TOKEN);
