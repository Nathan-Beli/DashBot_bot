const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder,
    ActionRowBuilder,
    RoleSelectMenuBuilder,
    ComponentType
} = require('discord.js');

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
    // Handling Select Menu Interaction for /setup
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
                .setTitle('⚙️ Staff Configuration Panel')
                .setDescription(`✅ The Staff role has been configured to <@&${selectedRoleId}>.\nMembers with this role can now use moderation commands.`);

            return interaction.update({ embeds: [updatedEmbed], components: [] });
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

        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('select_staff_role')
            .setPlaceholder('Select the Staff role...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(roleSelect);

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('⚙️ Staff Configuration Panel')
            .setDescription('Please select the Staff role below. Only members with this role will have access to staff-restricted commands.');

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
                { name: '/warnmember
