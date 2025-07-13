const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ComponentType // Beschreibung bereinigen
function cleanDescription(description) {
    if (!description) return 'Keine Beschreibung verfügbar';
    
    // HTML Tags entfernen
    let cleaned = description.replace(/<[^>]*>/g, '');
    
    // Auf 300 Zeichen kürzen
    if (cleaned.length > 300) {
        cleaned = cleaned.substring(0, 300) + '...';
    }
    
    return cleaned;
} = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

// Konfiguration
const CONFIG = {
    token: process.env.DISCORD_TOKEN, // Dein Discord Bot Token
    checkInterval: 5 * 60 * 1000, // 5 Minuten in Millisekunden
    dataFile: './feeds.json',
    port: process.env.PORT || 3000 // Port für Render
};

// RSS Parser initialisieren
const parser = new Parser();

// Discord Client erstellen
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// Datenstruktur für gespeicherte Feeds
let feedsData = {
    feeds: [],
    lastItems: {}
};

// Daten laden
function loadData() {
// Slash Command Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, member, guild, channel } = interaction;

    // Permissions prüfen
    if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: 'Du benötigst die "Nachrichten verwalten" Berechtigung!', ephemeral: true });
    }

    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            feedsData = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
        }
    } catch (error) {
        console.error('Fehler beim Laden der Daten:', error);
    }
}

// Daten speichern
function saveData() {
    try {
        fs.writeFileSync(CONFIG.dataFile, JSON.stringify(feedsData, null, 2));
    } catch (error) {
        console.error('Fehler beim Speichern der Daten:', error);
    }
}

// RSS Feed hinzufügen
function addFeed(url, channelId, guildId) {
    const feed = {
        id: Date.now().toString(),
        url,
        channelId,
        guildId,
        active: true,
        addedAt: new Date().toISOString()
    };
    
    feedsData.feeds.push(feed);
    saveData();
    return feed;
}

// RSS Feed entfernen
function removeFeed(feedId) {
    feedsData.feeds = feedsData.feeds.filter(feed => feed.id !== feedId);
    delete feedsData.lastItems[feedId];
    saveData();
}

// RSS Feed prüfen und neue Items posten
async function checkFeed(feed) {
    try {
        const parsedFeed = await parser.parseURL(feed.url);
        const channel = client.channels.cache.get(feed.channelId);
        
        if (!channel) {
            console.error(`Channel ${feed.channelId} nicht gefunden für Feed ${feed.id}`);
            return;
        }

        const lastItemKey = feed.id;
        const lastItemGuid = feedsData.lastItems[lastItemKey];
        
        // Neue Items finden
        const newItems = [];
        for (const item of parsedFeed.items) {
            if (lastItemGuid && item.guid === lastItemGuid) {
                break;
            }
            newItems.push(item);
        }
        
        // Neue Items in umgekehrter Reihenfolge posten (älteste zuerst)
        newItems.reverse();
        
        for (const item of newItems) {
            await postItem(channel, item, parsedFeed.title);
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 Sekunde warten zwischen Posts
        }
        
        // Letztes Item speichern
        if (parsedFeed.items.length > 0) {
            feedsData.lastItems[lastItemKey] = parsedFeed.items[0].guid;
            saveData();
        }
        
    } catch (error) {
        console.error(`Fehler beim Prüfen des Feeds ${feed.url}:`, error);
    }
}

// Item in Discord posten
async function postItem(channel, item, feedTitle) {
    try {
        const embed = new EmbedBuilder()
            .setTitle(item.title || 'Kein Titel')
            .setURL(item.link || null)
            .setDescription(cleanDescription(item.contentSnippet || item.content || 'Keine Beschreibung verfügbar'))
            .setFooter({ text: feedTitle })
            .setTimestamp(item.pubDate ? new Date(item.pubDate) : new Date())
            .setColor(0x0099FF);

        // Thumbnail hinzufügen wenn verfügbar
        if (item.enclosure && item.enclosure.url && item.enclosure.type?.startsWith('image/')) {
            embed.setThumbnail(item.enclosure.url);
        }

        await channel.send({ embeds: [embed] });
        console.log(`Neues Item gepostet: ${item.title} in #${channel.name}`);
        
    } catch (error) {
        console.error('Fehler beim Posten des Items:', error);
    }
}

// Dashboard erstellen
function createDashboard(guildId) {
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 RSS Dashboard')
        .setDescription('Verwalte deine RSS Feeds mit den Buttons unten')
        .setColor(0x0099FF)
        .addFields(
            { name: '📈 Aktive Feeds', value: guildFeeds.length.toString(), inline: true },
            { name: '🔄 Prüfintervall', value: '5 Minuten', inline: true },
            { name: '📝 Status', value: 'Online', inline: true }
        )
        .setFooter({ text: 'Nutze die Buttons zum Verwalten deiner Feeds' })
        .setTimestamp();

    // Buttons erstellen
    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('add_feed')
                .setLabel('📥 Feed hinzufügen')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('list_feeds')
                .setLabel('📋 Feeds anzeigen')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('test_feed')
                .setLabel('🧪 Feed testen')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('remove_feed')
                .setLabel('🗑️ Feed entfernen')
                .setStyle(ButtonStyle.Danger)
        );

    return { embeds: [embed], components: [buttons] };
}

// Feed-Liste mit Select Menu erstellen
function createFeedList(guildId) {
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    
    if (guildFeeds.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('📋 RSS Feeds')
            .setDescription('Keine RSS Feeds konfiguriert.')
            .setColor(0xFF9900);
        return { embeds: [embed], components: [] };
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 RSS Feeds')
        .setDescription(`Du hast ${guildFeeds.length} Feed(s) konfiguriert:`)
        .setColor(0x0099FF);

    // Feeds als Fields hinzufügen
    guildFeeds.forEach((feed, index) => {
        const channel = `<#${feed.channelId}>`;
        const status = feed.active ? '✅ Aktiv' : '❌ Inaktiv';
        const addedDate = new Date(feed.addedAt).toLocaleDateString('de-DE');
        
        embed.addFields({
            name: `Feed ${index + 1}`,
            value: `**URL:** ${feed.url}\n**Channel:** ${channel}\n**Status:** ${status}\n**Hinzugefügt:** ${addedDate}\n**ID:** \`${feed.id}\``,
            inline: false
        });
    });

    const backButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('dashboard')
                .setLabel('🔙 Zurück zum Dashboard')
                .setStyle(ButtonStyle.Secondary)
        );

    return { embeds: [embed], components: [backButton] };
}

// Modal für Feed hinzufügen
function createAddFeedModal() {
    const modal = new ModalBuilder()
        .setCustomId('add_feed_modal')
        .setTitle('📥 RSS Feed hinzufügen');

    const urlInput = new TextInputBuilder()
        .setCustomId('feed_url')
        .setLabel('RSS Feed URL')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/feed.xml')
        .setRequired(true);

    const channelInput = new TextInputBuilder()
        .setCustomId('target_channel')
        .setLabel('Ziel-Channel (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Leer lassen für aktuellen Channel')
        .setRequired(false);

    const urlRow = new ActionRowBuilder().addComponents(urlInput);
    const channelRow = new ActionRowBuilder().addComponents(channelInput);

    modal.addComponents(urlRow, channelRow);
    return modal;
}

// Modal für Feed testen
function createTestFeedModal() {
    const modal = new ModalBuilder()
        .setCustomId('test_feed_modal')
        .setTitle('🧪 RSS Feed testen');

    const urlInput = new TextInputBuilder()
        .setCustomId('test_url')
        .setLabel('RSS Feed URL')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/feed.xml')
        .setRequired(true);

    const urlRow = new ActionRowBuilder().addComponents(urlInput);
    modal.addComponents(urlRow);
    return modal;
}

// Select Menu für Feed entfernen
function createRemoveFeedMenu(guildId) {
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    
    if (guildFeeds.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Feed entfernen')
            .setDescription('Keine Feeds zum Entfernen vorhanden.')
            .setColor(0xFF9900);
            
        const backButton = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('dashboard')
                    .setLabel('🔙 Zurück zum Dashboard')
                    .setStyle(ButtonStyle.Secondary)
            );
            
        return { embeds: [embed], components: [backButton] };
    }

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Feed entfernen')
        .setDescription('Wähle den Feed aus, den du entfernen möchtest:')
        .setColor(0xFF4444);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('remove_feed_select')
        .setPlaceholder('Feed zum Entfernen auswählen...')
        .addOptions(
            guildFeeds.map(feed => {
                const url = feed.url.length > 50 ? feed.url.substring(0, 50) + '...' : feed.url;
                return {
                    label: url,
                    description: `Channel: #${feed.channelId} | ID: ${feed.id}`,
                    value: feed.id
                };
            })
        );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);
    
    const backButton = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('dashboard')
                .setLabel('🔙 Zurück zum Dashboard')
                .setStyle(ButtonStyle.Secondary)
        );

    return { embeds: [embed], components: [selectRow, backButton] };
}

// Alle aktiven Feeds prüfen
async function checkAllFeeds() {
    console.log(`Prüfe ${feedsData.feeds.length} Feeds...`);
    
    for (const feed of feedsData.feeds) {
        if (feed.active) {
            await checkFeed(feed);
        }
    }
}

// Bot Events
client.once('ready', () => {
    console.log(`Bot ist online als ${client.user.tag}`);
    loadData();
    
    // Sofort alle Feeds prüfen
    checkAllFeeds();
    
    // Interval für regelmäßige Prüfung
    setInterval(checkAllFeeds, CONFIG.checkInterval);
});

// Event für neue Server
client.on('guildCreate', async (guild) => {
    console.log(`Bot wurde zu neuem Server hinzugefügt: ${guild.name}`);
    
    // Commands für neuen Server registrieren
    const commands = [
        {
            name: 'rss-add',
            description: 'RSS Feed hinzufügen',
            options: [
                {
                    name: 'url',
                    type: 3,
                    description: 'RSS Feed URL',
                    required: true
                },
                {
                    name: 'channel',
                    type: 7,
                    description: 'Ziel-Channel (optional)',
                    required: false
                }
            ]
        },
        {
            name: 'rss-list',
            description: 'Alle RSS Feeds anzeigen'
        },
        {
            name: 'rss-remove',
            description: 'RSS Feed entfernen',
            options: [
                {
                    name: 'id',
                    type: 3,
                    description: 'Feed ID',
                    required: true
                }
            ]
        },
        {
            name: 'rss-test',
            description: 'RSS Feed testen',
            options: [
                {
                    name: 'url',
                    type: 3,
                    description: 'RSS Feed URL',
                    required: true
                }
            ]
        }
    ];
    
    try {
        await guild.commands.set(commands);
        console.log(`Commands für ${guild.name} registriert`);
    } catch (error) {
        console.error('Fehler beim Registrieren der Guild Commands:', error);
    }
});

// Slash Commands registrieren
client.once('ready', async () => {
    const commands = [
        {
            name: 'rss-add',
            description: 'RSS Feed hinzufügen',
            options: [
                {
                    name: 'url',
                    type: 3, // STRING
                    description: 'RSS Feed URL',
                    required: true
                },
                {
                    name: 'channel',
                    type: 7, // CHANNEL
                    description: 'Ziel-Channel (optional, aktueller Channel wird verwendet)',
                    required: false
                }
            ]
        },
        {
            name: 'rss-list',
            description: 'Alle RSS Feeds anzeigen'
        },
        {
            name: 'rss-remove',
            description: 'RSS Feed entfernen',
            options: [
                {
                    name: 'id',
                    type: 3, // STRING
                    description: 'Feed ID',
                    required: true
                }
            ]
        },
        {
            name: 'rss-test',
            description: 'RSS Feed testen',
            options: [
                {
                    name: 'url',
                    type: 3, // STRING
                    description: 'RSS Feed URL',
                    required: true
                }
            ]
        },
        {
            name: 'rss-dashboard',
            description: '📊 RSS Dashboard mit Buttons öffnen'
        }
    ];

    try {
        // Registriere Commands für alle Guilds (Server) wo der Bot ist
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(commands);
            console.log(`Slash Commands registriert für Server: ${guild.name}`);
        }
        
        // Zusätzlich auch global (dauert länger, aber als Backup)
        await client.application.commands.set(commands);
        console.log('Globale Slash Commands registriert');
    } catch (error) {
        console.error('Fehler beim Registrieren der Commands:', error);
    }
});

// Button und Modal Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    // Permissions prüfen für alle Interaktionen
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: 'Du benötigst die "Nachrichten verwalten" Berechtigung!', ephemeral: true });
    }

    try {
        // Button Interactions
        if (interaction.isButton()) {
            switch (interaction.customId) {
                case 'add_feed':
                    const addModal = createAddFeedModal();
                    await interaction.showModal(addModal);
                    break;

                case 'list_feeds':
                    const feedList = createFeedList(interaction.guild.id);
                    await interaction.reply({ ...feedList, ephemeral: true });
                    break;

                case 'test_feed':
                    const testModal = createTestFeedModal();
                    await interaction.showModal(testModal);
                    break;

                case 'remove_feed':
                    const removeMenu = createRemoveFeedMenu(interaction.guild.id);
                    await interaction.reply({ ...removeMenu, ephemeral: true });
                    break;

                case 'dashboard':
                    const dashboardData = createDashboard(interaction.guild.id);
                    await interaction.update(dashboardData);
                    break;
            }
        }

        // Modal Interactions
        if (interaction.isModalSubmit()) {
            switch (interaction.customId) {
                case 'add_feed_modal':
                    const feedUrl = interaction.fields.getTextInputValue('feed_url');
                    const channelInput = interaction.fields.getTextInputValue('target_channel');
                    
                    let targetChannel = interaction.channel;
                    
                    // Channel parsing
                    if (channelInput) {
                        const channelMatch = channelInput.match(/^<#(\d+)>$/) || channelInput.match(/^(\d+)$/);
                        if (channelMatch) {
                            const foundChannel = interaction.guild.channels.cache.get(channelMatch[1]);
                            if (foundChannel) {
                                targetChannel = foundChannel;
                            }
                        }
                    }
                    
                    if (!feedUrl.startsWith('http')) {
                        return interaction.reply({ content: '❌ Bitte gib eine gültige URL an!', ephemeral: true });
                    }
                    
                    const existingFeed = feedsData.feeds.find(f => f.url === feedUrl && f.channelId === targetChannel.id);
                    if (existingFeed) {
                        return interaction.reply({ content: '❌ Dieser Feed existiert bereits in diesem Channel!', ephemeral: true });
                    }
                    
                    await interaction.deferReply({ ephemeral: true });
                    
                    try {
                        await parser.parseURL(feedUrl);
                        const newFeed = addFeed(feedUrl, targetChannel.id, interaction.guild.id);
                        
                        const successEmbed = new EmbedBuilder()
                            .setTitle('✅ Feed erfolgreich hinzugefügt')
                            .setColor(0x00FF00)
                            .addFields(
                                { name: 'URL', value: feedUrl, inline: false },
                                { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true },
                                { name: 'Feed ID', value: newFeed.id, inline: true }
                            )
                            .setTimestamp();
                            
                        await interaction.editReply({ embeds: [successEmbed] });
                    } catch (error) {
                        await interaction.editReply({ content: `❌ Fehler beim Hinzufügen des Feeds: ${error.message}` });
                    }
                    break;

                case 'test_feed_modal':
                    const testUrl = interaction.fields.getTextInputValue('test_url');
                    
                    if (!testUrl.startsWith('http')) {
                        return interaction.reply({ content: '❌ Bitte gib eine gültige URL an!', ephemeral: true });
                    }
                    
                    await interaction.deferReply({ ephemeral: true });
                    
                    try {
                        const testFeed = await parser.parseURL(testUrl);
                        const latestItem = testFeed.items[0];
                        
                        const testEmbed = new EmbedBuilder()
                            .setTitle('🧪 RSS Feed Test')
                            .setColor(0x00FF00)
                            .addFields(
                                { name: 'Feed Titel', value: testFeed.title || 'Unbekannt', inline: false },
                                { name: 'Items gefunden', value: testFeed.items.length.toString(), inline: true },
                                { name: 'Letztes Item', value: latestItem ? latestItem.title : 'Keine Items', inline: true }
                            )
                            .setFooter({ text: 'Feed ist gültig und kann hinzugefügt werden' });
                        
                        await interaction.editReply({ embeds: [testEmbed] });
                    } catch (error) {
                        await interaction.editReply({ content: `❌ Feed-Test fehlgeschlagen: ${error.message}` });
                    }
                    break;
            }
        }

        // Select Menu Interactions
        if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'remove_feed_select':
                    const feedToRemove = feedsData.feeds.find(f => f.id === interaction.values[0]);
                    
                    if (!feedToRemove) {
                        return interaction.reply({ content: '❌ Feed nicht gefunden!', ephemeral: true });
                    }
                    
                    removeFeed(interaction.values[0]);
                    
                    const removeEmbed = new EmbedBuilder()
                        .setTitle('🗑️ Feed entfernt')
                        .setDescription(`Feed wurde erfolgreich entfernt:\n**${feedToRemove.url}**`)
                        .setColor(0xFF4444)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [removeEmbed], ephemeral: true });
                    break;
            }
        }
    } catch (error) {
        console.error('Fehler bei Button/Modal Interaction:', error);
        if (interaction.deferred) {
            await interaction.editReply('❌ Ein Fehler ist aufgetreten!');
        } else {
            await interaction.reply({ content: '❌ Ein Fehler ist aufgetreten!', ephemeral: true });
        }
    }
});

    try {
        switch (commandName) {
            case 'rss-dashboard':
                const dashboardData = createDashboard(guild.id);
                await interaction.reply(dashboardData);
                break;

            case 'rss-add':
                const url = options.getString('url');
                const targetChannel = options.getChannel('channel') || channel;
                
                // URL validieren
                if (!url.startsWith('http')) {
                    return interaction.reply({ content: 'Bitte gib eine gültige URL an!', ephemeral: true });
                }
                
                // Prüfen ob Feed bereits existiert
                const existingFeed = feedsData.feeds.find(f => f.url === url && f.channelId === targetChannel.id);
                if (existingFeed) {
                    return interaction.reply({ content: 'Dieser Feed existiert bereits in diesem Channel!', ephemeral: true });
                }
                
                // Feed testen
                await interaction.deferReply();
                try {
                    await parser.parseURL(url);
                    const newFeed = addFeed(url, targetChannel.id, guild.id);
                    await interaction.editReply(`✅ RSS Feed erfolgreich hinzugefügt!\n**URL:** ${url}\n**Channel:** <#${targetChannel.id}>\n**ID:** ${newFeed.id}`);
                } catch (error) {
                    await interaction.editReply(`❌ Fehler beim Hinzufügen des Feeds: ${error.message}`);
                }
                break;
                const url = options.getString('url');
                const targetChannel = options.getChannel('channel') || channel;
                
                // URL validieren
                if (!url.startsWith('http')) {
                    return interaction.reply({ content: 'Bitte gib eine gültige URL an!', ephemeral: true });
                }
                
                // Prüfen ob Feed bereits existiert
                const existingFeed = feedsData.feeds.find(f => f.url === url && f.channelId === targetChannel.id);
                if (existingFeed) {
                    return interaction.reply({ content: 'Dieser Feed existiert bereits in diesem Channel!', ephemeral: true });
                }
                
                // Feed testen
                await interaction.deferReply();
                try {
                    await parser.parseURL(url);
                    const newFeed = addFeed(url, targetChannel.id, guild.id);
                    await interaction.editReply(`✅ RSS Feed erfolgreich hinzugefügt!\n**URL:** ${url}\n**Channel:** <#${targetChannel.id}>\n**ID:** ${newFeed.id}`);
                } catch (error) {
                    await interaction.editReply(`❌ Fehler beim Hinzufügen des Feeds: ${error.message}`);
                }
                break;

            case 'rss-list':
                const guildFeeds = feedsData.feeds.filter(f => f.guildId === guild.id);
                
                if (guildFeeds.length === 0) {
                    return interaction.reply({ content: 'Keine RSS Feeds konfiguriert.', ephemeral: true });
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('RSS Feeds')
                    .setColor(0x0099FF)
                    .setDescription(guildFeeds.map(feed => 
                        `**ID:** ${feed.id}\n**URL:** ${feed.url}\n**Channel:** <#${feed.channelId}>\n**Status:** ${feed.active ? '✅ Aktiv' : '❌ Inaktiv'}\n`
                    ).join('\n'))
                    .setFooter({ text: `${guildFeeds.length} Feed(s) total` });
                
                await interaction.reply({ embeds: [embed], ephemeral: true });
                break;

            case 'rss-remove':
                const feedId = options.getString('id');
                const feedToRemove = feedsData.feeds.find(f => f.id === feedId && f.guildId === guild.id);
                
                if (!feedToRemove) {
                    return interaction.reply({ content: 'Feed nicht gefunden!', ephemeral: true });
                }
                
                removeFeed(feedId);
                await interaction.reply(`✅ RSS Feed entfernt: ${feedToRemove.url}`);
                break;

            case 'rss-test':
                const testUrl = options.getString('url');
                
                if (!testUrl.startsWith('http')) {
                    return interaction.reply({ content: 'Bitte gib eine gültige URL an!', ephemeral: true });
                }
                
                await interaction.deferReply();
                try {
                    const testFeed = await parser.parseURL(testUrl);
                    const latestItem = testFeed.items[0];
                    
                    const testEmbed = new EmbedBuilder()
                        .setTitle('🧪 RSS Feed Test')
                        .setColor(0x00FF00)
                        .addFields(
                            { name: 'Feed Titel', value: testFeed.title || 'Unbekannt', inline: true },
                            { name: 'Items gefunden', value: testFeed.items.length.toString(), inline: true },
                            { name: 'Letztes Item', value: latestItem ? latestItem.title : 'Keine Items', inline: false }
                        )
                        .setFooter({ text: 'Feed ist gültig und kann hinzugefügt werden' });
                    
                    await interaction.editReply({ embeds: [testEmbed] });
                } catch (error) {
                    await interaction.editReply(`❌ Feed-Test fehlgeschlagen: ${error.message}`);
                }
                break;
        }
    } catch (error) {
        console.error('Fehler beim Ausführen des Commands:', error);
        if (interaction.deferred) {
            await interaction.editReply('❌ Ein Fehler ist aufgetreten!');
        } else {
            await interaction.reply({ content: '❌ Ein Fehler ist aufgetreten!', ephemeral: true });
        }
    }
});

// Fehlerbehandlung
client.on('error', error => {
    console.error('Discord Client Fehler:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled Promise Rejection:', error);
});

// Bot starten
client.login(CONFIG.token);

// Einfacher HTTP Server für Render (damit es als Web Service läuft)
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Discord RSS Bot ist online!');
});

app.listen(CONFIG.port, () => {
    console.log(`HTTP Server läuft auf Port ${CONFIG.port}`);
});
