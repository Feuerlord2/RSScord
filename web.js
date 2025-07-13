const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const Parser = require('rss-parser');

// Konfiguration
const CONFIG = {
    port: process.env.WEB_PORT || 3001,
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackUrl: process.env.CALLBACK_URL || 'http://localhost:3001/auth/discord/callback',
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret-here',
    dataFile: './feeds.json'
};

const app = express();
const parser = new Parser();

// Feeds-Daten laden
let feedsData = { feeds: [], lastItems: {} };

function loadData() {
    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            feedsData = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
        }
    } catch (error) {
        console.error('Fehler beim Laden der Web-Daten:', error);
    }
}

function saveData() {
    try {
        fs.writeFileSync(CONFIG.dataFile, JSON.stringify(feedsData, null, 2));
    } catch (error) {
        console.error('Fehler beim Speichern der Web-Daten:', error);
    }
}

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session-Management
app.use(session({
    secret: CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 Stunden
}));

// Passport-Konfiguration
passport.use(new DiscordStrategy({
    clientID: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret,
    callbackURL: CONFIG.callbackUrl,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// Auth-Middleware
function requireAuth(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Auth-Routes
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
});

// API-Routes
app.get('/api/user', requireAuth, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        discriminator: req.user.discriminator,
        avatar: req.user.avatar,
        guilds: req.user.guilds?.filter(guild => 
            (parseInt(guild.permissions) & 0x20) === 0x20 // MANAGE_MESSAGES
        ) || []
    });
});

app.get('/api/feeds/:guildId', requireAuth, (req, res) => {
    loadData();
    const guildId = req.params.guildId;
    const guildFeeds = feedsData.feeds.filter(f => f.guildId === guildId);
    res.json(guildFeeds);
});

app.post('/api/feeds', requireAuth, async (req, res) => {
    try {
        const { url, channelId, guildId, rolePing } = req.body;
        
        // Validierung
        if (!url || !channelId || !guildId) {
            return res.status(400).json({ error: 'Fehlende Parameter' });
        }
        
        if (!url.startsWith('http')) {
            return res.status(400).json({ error: 'Ungültige URL' });
        }
        
        // Prüfen ob Feed bereits existiert
        loadData();
        const existingFeed = feedsData.feeds.find(f => f.url === url && f.channelId === channelId);
        if (existingFeed) {
            return res.status(400).json({ error: 'Feed existiert bereits in diesem Channel' });
        }
        
        // Feed testen
        await parser.parseURL(url);
        
        // Feed hinzufügen
        const newFeed = {
            id: Date.now().toString(),
            url,
            channelId,
            guildId,
            rolePing: rolePing || null,
            active: true,
            addedAt: new Date().toISOString()
        };
        
        feedsData.feeds.push(newFeed);
        saveData();
        
        res.json({ success: true, feed: newFeed });
    } catch (error) {
        console.error('Fehler beim Hinzufügen des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/feeds/:feedId', requireAuth, (req, res) => {
    try {
        loadData();
        const feedId = req.params.feedId;
        const feedIndex = feedsData.feeds.findIndex(f => f.id === feedId);
        
        if (feedIndex === -1) {
            return res.status(404).json({ error: 'Feed nicht gefunden' });
        }
        
        feedsData.feeds.splice(feedIndex, 1);
        delete feedsData.lastItems[feedId];
        saveData();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Löschen des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/feeds/:feedId', requireAuth, (req, res) => {
    try {
        loadData();
        const feedId = req.params.feedId;
        const { rolePing, active } = req.body;
        
        const feed = feedsData.feeds.find(f => f.id === feedId);
        if (!feed) {
            return res.status(404).json({ error: 'Feed nicht gefunden' });
        }
        
        if (rolePing !== undefined) feed.rolePing = rolePing;
        if (active !== undefined) feed.active = active;
        
        saveData();
        res.json({ success: true, feed });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/feeds/test', requireAuth, async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Ungültige URL' });
        }
        
        const feed = await parser.parseURL(url);
        const latestItem = feed.items[0];
        
        res.json({
            success: true,
            title: feed.title,
            itemCount: feed.items.length,
            latestItem: latestItem ? {
                title: latestItem.title,
                pubDate: latestItem.pubDate,
                link: latestItem.link
            } : null
        });
    } catch (error) {
        console.error('Fehler beim Testen des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

// Server starten
loadData();

app.listen(CONFIG.port, () => {
    console.log(`Web-Interface läuft auf Port ${CONFIG.port}`);
    console.log(`URL: http://localhost:${CONFIG.port}`);
});
