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
    port: process.env.PORT || 3001, // Render setzt automatisch PORT
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackUrl: process.env.CALLBACK_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/auth/discord/callback`,
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

// Session-Management (FIX für Render.com)
app.use(session({
    secret: CONFIG.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // WICHTIG: Auch in Production false für Render
        maxAge: 24 * 60 * 60 * 1000, // 24 Stunden
        httpOnly: true,
        sameSite: 'lax' // Wichtig für OAuth
    },
    name: 'rsscord_session'
}));

// Passport-Konfiguration
if (CONFIG.clientId && CONFIG.clientSecret) {
    passport.use(new DiscordStrategy({
        clientID: CONFIG.clientId,
        clientSecret: CONFIG.clientSecret,
        callbackURL: CONFIG.callbackUrl,
        scope: ['identify', 'guilds']
    }, (accessToken, refreshToken, profile, done) => {
        console.log(`✅ Discord OAuth successful: ${profile.username}#${profile.discriminator}`);
        return done(null, profile);
    }));
} else {
    console.error('❌ Discord OAuth nicht konfiguriert - CLIENT_ID oder CLIENT_SECRET fehlt');
}

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
    console.log(`🏠 Hauptseite-Zugriff von Session: ${req.sessionID}`);
    console.log(`🔐 Authentifiziert: ${req.isAuthenticated()}`);
    
    if (req.isAuthenticated()) {
        console.log(`👤 Bereits eingeloggt als: ${req.user.username}, redirect zu Dashboard`);
        return res.redirect('/dashboard');
    }
    
    // Error-Parameter aus URL lesen
    const error = req.query.error;
    if (error) {
        console.log(`⚠️ Login-Fehler: ${error}`);
    }
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    console.log(`📊 Dashboard-Zugriff von Session: ${req.sessionID}`);
    console.log(`🔐 Authentifiziert: ${req.isAuthenticated()}`);
    console.log(`👤 User: ${req.user ? req.user.username : 'null'}`);
    
    if (req.isAuthenticated()) {
        res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        console.log('❌ Nicht authentifiziert, redirect zu Login');
        res.redirect('/?error=not_authenticated');
    }
});

// Auth-Routes
app.get('/auth/discord', (req, res, next) => {
    if (!CONFIG.clientId || !CONFIG.clientSecret) {
        return res.status(500).send(`
            <h1>OAuth-Konfiguration fehlt</h1>
            <p>DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET müssen in den Environment Variables gesetzt werden.</p>
            <p><a href="/">Zurück zur Startseite</a></p>
        `);
    }
    passport.authenticate('discord')(req, res, next);
});

app.get('/auth/discord/callback',
    (req, res, next) => {
        console.log('🔄 Discord Callback empfangen:', req.query);
        next();
    },
    passport.authenticate('discord', { 
        failureRedirect: '/?error=oauth_failed',
        failureMessage: true 
    }),
    (req, res) => {
        console.log(`✅ User erfolgreich eingeloggt: ${req.user.username}#${req.user.discriminator}`);
        console.log(`🍪 Session ID: ${req.sessionID}`);
        console.log(`🔐 User ID: ${req.user.id}`);
        res.redirect('/dashboard');
    }
);

// Debug Route für Session-Check
app.get('/auth/check', (req, res) => {
    res.json({
        authenticated: req.isAuthenticated(),
        sessionID: req.sessionID,
        user: req.user || null,
        session: req.session
    });
});

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
    // Immer frische Daten laden
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
        
        // Frische Daten laden vor dem Prüfen
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
        
        console.log(`📥 Web: Feed hinzugefügt - ${url} für Guild ${guildId}`);
        res.json({ success: true, feed: newFeed });
    } catch (error) {
        console.error('Fehler beim Hinzufügen des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/feeds/:feedId', requireAuth, (req, res) => {
    try {
        // Frische Daten laden
        loadData();
        const feedId = req.params.feedId;
        const feedIndex = feedsData.feeds.findIndex(f => f.id === feedId);
        
        if (feedIndex === -1) {
            return res.status(404).json({ error: 'Feed nicht gefunden' });
        }
        
        const deletedFeed = feedsData.feeds[feedIndex];
        feedsData.feeds.splice(feedIndex, 1);
        delete feedsData.lastItems[feedId];
        saveData();
        
        console.log(`🗑️ Web: Feed gelöscht - ${deletedFeed.url}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Fehler beim Löschen des Feeds:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/feeds/:feedId', requireAuth, (req, res) => {
    try {
        // Frische Daten laden
        loadData();
        const feedId = req.params.feedId;
        const { rolePing, active } = req.body;
        
        const feed = feedsData.feeds.find(f => f.id === feedId);
        if (!feed) {
            return res.status(404).json({ error: 'Feed nicht gefunden' });
        }
        
        const oldState = { rolePing: feed.rolePing, active: feed.active };
        
        if (rolePing !== undefined) feed.rolePing = rolePing;
        if (active !== undefined) feed.active = active;
        
        saveData();
        
        console.log(`🔄 Web: Feed aktualisiert - ${feed.url}`, { 
            old: oldState, 
            new: { rolePing: feed.rolePing, active: feed.active } 
        });
        
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

// Neuer Endpoint für Live-Status
app.get('/api/status', requireAuth, (req, res) => {
    loadData(); // Frische Daten laden
    
    const totalFeeds = feedsData.feeds.length;
    const activeFeeds = feedsData.feeds.filter(f => f.active).length;
    const feedsWithRoles = feedsData.feeds.filter(f => f.rolePing).length;
    
    res.json({
        totalFeeds,
        activeFeeds,
        feedsWithRoles,
        lastUpdate: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Debug-Endpoint (nur für Entwicklung)
app.get('/api/debug/feeds', requireAuth, (req, res) => {
    if (process.env.NODE_ENV !== 'development' && process.env.RSS_DEBUG !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    
    loadData();
    res.json({
        feeds: feedsData.feeds,
        lastItems: Object.keys(feedsData.lastItems).length,
        timestamp: new Date().toISOString()
    });
});

// Server starten
loadData();

app.listen(CONFIG.port, () => {
    console.log(`Web-Interface läuft auf Port ${CONFIG.port}`);
    console.log(`URL: http://localhost:${CONFIG.port}`);
});
