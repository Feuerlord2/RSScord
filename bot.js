const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
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
        }
    ];

    try {
        await client.application.commands.set(commands);
        console.log('Slash Commands registriert');
    } catch (error) {
        console.error('Fehler beim Registrieren der Commands:', error);
    }
});

// Slash Command Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, member, guild, channel } = interaction;

    // Permissions prüfen
    if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: 'Du benötigst die "Nachrichten verwalten" Berechtigung!', ephemeral: true });
    }

    try {
        switch (commandName) {
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
