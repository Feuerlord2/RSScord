const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Beschreibung bereinigen
function cleanDescription(description) {
    if (!description) return 'Keine Beschreibung verfügbar';
    
    // HTML Tags entfernen
    let cleaned = description.replace(/<[^>]*>/g, '');
    
    // Auf 300 Zeichen kürzen
    if (cleaned.length > 300) {
        cleaned = cleaned.substring(0, 300) + '...';
    }
    
    return cleaned;
}

// Konfiguration
const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    checkInterval: 5 * 60 * 1000, // 5 Minuten
    dataFile: './feeds.json',
    port: process.env.PORT || 3000
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

// Feed-Checking Status
let isCheckingFeeds = false;

// Daten laden
function loadData() {
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
function addFeed(url, channelId, guildId, rolePing = null) {
    const feed = {
        id: Date.now().toString(),
        url,
        channelId,
        guildId,
        rolePing,
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
            await postItem(channel, item, parsedFeed.title, feed.rolePing);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 Sekunden warten zwischen Posts
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
async function postItem(channel, item, feedTitle, rolePing) {
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

        // Rolle pinnen falls konfiguriert
        let content = null;
        if (rolePing) {
            content = `<@&${rolePing}>`;
        }

        await channel.send({ content, embeds: [embed] });
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
    const row1 = new ActionRowBuilder()
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
                .setStyle(ButtonStyle.Success)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('remove_feed')
                .setLabel('🗑️ Feed entfernen')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('manage_roles')
                .setLabel('🔔 Rollen verwalten')
                .setStyle(ButtonStyle.Secondary)
        );

    return { embeds: [embed], components: [row1, row2] };
}

// Feed-Liste mit Select Menu erstellen
function createFeedList(guildId) {
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    
    if (guildFeeds.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('📋 RSS Feeds')
            .setDescription('Keine RSS Feeds konfiguriert.')
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
        .setTitle('📋 RSS Feeds')
        .setDescription(`Du hast ${guildFeeds.length} Feed(s) konfiguriert:`)
        .setColor(0x0099FF);

    // Feeds als Fields hinzufügen
    guildFeeds.forEach((feed, index) => {
        const channel = `<#${feed.channelId}>`;
        const status = feed.active ? '✅ Aktiv' : '❌ Inaktiv';
        const addedDate = new Date(feed.addedAt).toLocaleDateString('de-DE');
        const rolePing = feed.rolePing ? `<@&${feed.rolePing}>` : 'Keine';
        
        embed.addFields({
            name: `Feed ${index + 1}`,
            value: `**URL:** ${feed.url}\n**Channel:** ${channel}\n**Status:** ${status}\n**Rolle:** ${rolePing}\n**Hinzugefügt:** ${addedDate}\n**ID:** \`${feed.id}\``,
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

    const roleInput = new TextInputBuilder()
        .setCustomId('role_ping')
        .setLabel('Rolle zum Pingen (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('@RollenName oder Rollen-ID')
        .setRequired(false);

    const urlRow = new ActionRowBuilder().addComponents(urlInput);
    const channelRow = new ActionRowBuilder().addComponents(channelInput);
    const roleRow = new ActionRowBuilder().addComponents(roleInput);

    modal.addComponents(urlRow, channelRow, roleRow);
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

// Rollen-Management Menu
function createRoleManagementMenu(guildId) {
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    
    if (guildFeeds.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('🔔 Rollen verwalten')
            .setDescription('Keine Feeds zum Verwalten vorhanden.')
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
        .setTitle('🔔 Rollen verwalten')
        .setDescription('Wähle einen Feed aus, um seine Rollen-Pings zu verwalten:')
        .setColor(0x0099FF);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('manage_role_select')
        .setPlaceholder('Feed auswählen...')
        .addOptions(
            guildFeeds.map(feed => {
                const url = feed.url.length > 50 ? feed.url.substring(0, 50) + '...' : feed.url;
                const rolePing = feed.rolePing ? ' (🔔)' : '';
                return {
                    label: url + rolePing,
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

// Modal für Rollen-Management
function createRoleModal(feedId) {
    const feed = feedsData.feeds.find(f => f.id === feedId);
    if (!feed) return null;

    const modal = new ModalBuilder()
        .setCustomId(`role_modal_${feedId}`)
        .setTitle('🔔 Rollen-Ping konfigurieren');

    const roleInput = new TextInputBuilder()
        .setCustomId('role_ping_input')
        .setLabel('Rolle zum Pingen')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('@RollenName oder Rollen-ID (leer lassen zum Entfernen)')
        .setValue(feed.rolePing || '')
        .setRequired(false);

    const roleRow = new ActionRowBuilder().addComponents(roleInput);
    modal.addComponents(roleRow);
    return modal;
}

// Alle aktiven Feeds prüfen
async function checkAllFeeds() {
    if (isCheckingFeeds) {
        console.log('Feed-Prüfung bereits im Gange, überspringe...');
        return;
    }

    isCheckingFeeds = true;
    const activeFeeds = feedsData.feeds.filter(f => f.active);
    console.log(`Prüfe ${activeFeeds.length} aktive Feeds...`);
    
    for (const feed of activeFeeds) {
        try {
            await checkFeed(feed);
            // Kleine Pause zwischen Feeds
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Fehler beim Prüfen von Feed ${feed.id}:`, error);
        }
    }
    
    console.log('Feed-Prüfung abgeschlossen');
    isCheckingFeeds = false;
}

// Rollen-ID aus Input parsen
function parseRoleInput(input, guild) {
    if (!input || input.trim() === '') return null;
    
    // Versuche direkte ID
    const directId = input.match(/^\d+$/);
    if (directId) {
        const role = guild.roles.cache.get(directId[0]);
        return role ? role.id : null;
    }
    
    // Versuche Mention Format
    const mentionMatch = input.match(/^<@&(\d+)>$/);
    if (mentionMatch) {
        const role = guild.roles.cache.get(mentionMatch[1]);
        return role ? role.id : null;
    }
    
    // Versuche Rollennamen
    const roleByName = guild.roles.cache.find(role => 
        role.name.toLowerCase() === input.toLowerCase()
    );
    return roleByName ? roleByName.id : null;
}

// Bot Events
client.once('ready', async () => {
    console.log(`Bot ist online als ${client.user.tag}`);
    loadData();
    
    // Warte kurz bevor erste Prüfung
    setTimeout(() => {
        checkAllFeeds();
    }, 5000);
    
    // Interval für regelmäßige Prüfung
    setInterval(checkAllFeeds, CONFIG.checkInterval);
    
    // Slash Commands registrieren
    const commands = [
        {
            name: 'rss-dashboard',
            description: '📊 RSS Dashboard mit Buttons öffnen'
        }
    ];

    try {
        // Registriere Commands für alle Guilds
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(commands);
            console.log(`Slash Commands registriert für Server: ${guild.name}`);
        }
        
        await client.application.commands.set(commands);
        console.log('Globale Slash Commands registriert');
    } catch (error) {
        console.error('Fehler beim Registrieren der Commands:', error);
    }
});

// Event für neue Server
client.on('guildCreate', async (guild) => {
    console.log(`Bot wurde zu neuem Server hinzugefügt: ${guild.name}`);
    
    const commands = [
        {
            name: 'rss-dashboard',
            description: '📊 RSS Dashboard mit Buttons öffnen'
        }
    ];
    
    try {
        await guild.commands.set(commands);
        console.log(`Commands für ${guild.name} registriert`);
    } catch (error) {
        console.error('Fehler beim Registrieren der Guild Commands:', error);
    }
});

// Slash Command Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, member, guild } = interaction;

    // Permissions prüfen
    if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ 
            content: 'Du benötigst die "Nachrichten verwalten" Berechtigung!', 
            flags: 64 // Ephemeral flag
        });
    }

    try {
        if (commandName === 'rss-dashboard') {
            const dashboardData = createDashboard(guild.id);
            await interaction.reply(dashboardData);
        }
    } catch (error) {
        console.error('Fehler beim Ausführen des Commands:', error);
        if (interaction.deferred) {
            await interaction.editReply('❌ Ein Fehler ist aufgetreten!');
        } else {
            await interaction.reply({ 
                content: '❌ Ein Fehler ist aufgetreten!', 
                flags: 64 
            });
        }
    }
});

// Button und Modal Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;

    // Permissions prüfen für alle Interaktionen
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ 
            content: 'Du benötigst die "Nachrichten verwalten" Berechtigung!', 
            flags: 64 
        });
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
                    await interaction.reply({ ...feedList, flags: 64 });
                    break;

                case 'test_feed':
                    const testModal = createTestFeedModal();
                    await interaction.showModal(testModal);
                    break;

                case 'remove_feed':
                    const removeMenu = createRemoveFeedMenu(interaction.guild.id);
                    await interaction.reply({ ...removeMenu, flags: 64 });
                    break;

                case 'manage_roles':
                    const roleMenu = createRoleManagementMenu(interaction.guild.id);
                    await interaction.reply({ ...roleMenu, flags: 64 });
                    break;

                case 'dashboard':
                    const dashboardData = createDashboard(interaction.guild.id);
                    await interaction.update(dashboardData);
                    break;
            }
        }

        // Modal Interactions
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'add_feed_modal') {
                const feedUrl = interaction.fields.getTextInputValue('feed_url');
                const channelInput = interaction.fields.getTextInputValue('target_channel');
                const roleInput = interaction.fields.getTextInputValue('role_ping');
                
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
                
                // Rolle parsing
                let rolePing = null;
                if (roleInput) {
                    rolePing = parseRoleInput(roleInput, interaction.guild);
                }
                
                if (!feedUrl.startsWith('http')) {
                    return interaction.reply({ 
                        content: '❌ Bitte gib eine gültige URL an!', 
                        flags: 64 
                    });
                }
                
                const existingFeed = feedsData.feeds.find(f => f.url === feedUrl && f.channelId === targetChannel.id);
                if (existingFeed) {
                    return interaction.reply({ 
                        content: '❌ Dieser Feed existiert bereits in diesem Channel!', 
                        flags: 64 
                    });
                }
                
                await interaction.deferReply({ flags: 64 });
                
                try {
                    await parser.parseURL(feedUrl);
                    const newFeed = addFeed(feedUrl, targetChannel.id, interaction.guild.id, rolePing);
                    
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Feed erfolgreich hinzugefügt')
                        .setColor(0x00FF00)
                        .addFields(
                            { name: 'URL', value: feedUrl, inline: false },
                            { name: 'Channel', value: `<#${targetChannel.id}>`, inline: true },
                            { name: 'Rolle', value: rolePing ? `<@&${rolePing}>` : 'Keine', inline: true },
                            { name: 'Feed ID', value: newFeed.id, inline: true }
                        )
                        .setTimestamp();
                        
                    await interaction.editReply({ embeds: [successEmbed] });
                } catch (error) {
                    await interaction.editReply({ 
                        content: `❌ Fehler beim Hinzufügen des Feeds: ${error.message}` 
                    });
                }
            }
            
            else if (interaction.customId === 'test_feed_modal') {
                const testUrl = interaction.fields.getTextInputValue('test_url');
                
                if (!testUrl.startsWith('http')) {
                    return interaction.reply({ 
                        content: '❌ Bitte gib eine gültige URL an!', 
                        flags: 64 
                    });
                }
                
                await interaction.deferReply({ flags: 64 });
                
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
                    await interaction.editReply({ 
                        content: `❌ Feed-Test fehlgeschlagen: ${error.message}` 
                    });
                }
            }
            
            else if (interaction.customId.startsWith('role_modal_')) {
                const feedId = interaction.customId.replace('role_modal_', '');
                const roleInput = interaction.fields.getTextInputValue('role_ping_input');
                
                const feed = feedsData.feeds.find(f => f.id === feedId);
                if (!feed) {
                    return interaction.reply({ 
                        content: '❌ Feed nicht gefunden!', 
                        flags: 64 
                    });
                }
                
                let rolePing = null;
                if (roleInput && roleInput.trim() !== '') {
                    rolePing = parseRoleInput(roleInput, interaction.guild);
                    if (!rolePing) {
                        return interaction.reply({ 
                            content: '❌ Rolle nicht gefunden!', 
                            flags: 64 
                        });
                    }
                }
                
                // Feed updaten
                feed.rolePing = rolePing;
                saveData();
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Rollen-Ping konfiguriert')
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Feed URL', value: feed.url, inline: false },
                        { name: 'Rolle', value: rolePing ? `<@&${rolePing}>` : 'Entfernt', inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed], flags: 64 });
            }
        }

        // Select Menu Interactions
        if (interaction.isStringSelectMenu()) {
            switch (interaction.customId) {
                case 'remove_feed_select':
                    const feedToRemove = feedsData.feeds.find(f => f.id === interaction.values[0]);
                    
                    if (!feedToRemove) {
                        return interaction.reply({ 
                            content: '❌ Feed nicht gefunden!', 
                            flags: 64 
                        });
                    }
                    
                    removeFeed(interaction.values[0]);
                    
                    const removeEmbed = new EmbedBuilder()
                        .setTitle('🗑️ Feed entfernt')
                        .setDescription(`Feed wurde erfolgreich entfernt:\n**${feedToRemove.url}**`)
                        .setColor(0xFF4444)
                        .setTimestamp();
                    
                    await interaction.reply({ embeds: [removeEmbed], flags: 64 });
                    break;

                case 'manage_role_select':
                    const feedId = interaction.values[0];
                    const roleModal = createRoleModal(feedId);
                    
                    if (!roleModal) {
                        return interaction.reply({ 
                            content: '❌ Feed nicht gefunden!', 
                            flags: 64 
                        });
                    }
                    
                    await interaction.showModal(roleModal);
                    break;
            }
        }
    } catch (error) {
        console.error('Fehler bei Button/Modal Interaction:', error);
        if (interaction.deferred) {
            await interaction.editReply('❌ Ein Fehler ist aufgetreten!');
        } else {
            await interaction.reply({ 
                content: '❌ Ein Fehler ist aufgetreten!', 
                flags: 64 
            });
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

process.on('uncaughtException', error => {
    console.error('Uncaught Exception:', error);
});

// Bot starten
client.login(CONFIG.token);

// Einfacher HTTP Server für Render
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        feeds: feedsData.feeds.length,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        bot: client.user ? 'connected' : 'disconnected',
        feeds: feedsData.feeds.length
    });
});

app.listen(CONFIG.port, () => {
    console.log(`HTTP Server läuft auf Port ${CONFIG.port}`);
});
