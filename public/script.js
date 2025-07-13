// Global variables
let currentUser = null;
let currentGuild = null;
let feeds = [];
let refreshInterval = null;

// DOM Elements
const guildSelect = document.getElementById('guildSelect');
const welcomeMessage = document.getElementById('welcomeMessage');
const dashboardContent = document.getElementById('dashboardContent');
const addFeedBtn = document.getElementById('addFeedBtn');
const addFeedModal = document.getElementById('addFeedModal');
const closeModal = document.getElementById('closeModal');
const addFeedForm = document.getElementById('addFeedForm');
const testFeedBtn = document.getElementById('testFeedBtn');
const feedsList = document.getElementById('feedsList');
const loading = document.getElementById('loading');
const toastContainer = document.getElementById('toastContainer');

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await loadUser();
    setupEventListeners();
    startAutoRefresh();
});

// Auto-refresh alle 30 Sekunden
function startAutoRefresh() {
    refreshInterval = setInterval(async () => {
        if (currentGuild) {
            await loadFeeds(true); // Silent refresh
        }
    }, 30000); // 30 Sekunden
}

// Cleanup bei Seitenwechsel
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});

// Load user data
async function loadUser() {
    try {
        showLoading(true);
        const response = await fetch('/api/user');
        
        if (!response.ok) {
            window.location.href = '/';
            return;
        }
        
        currentUser = await response.json();
        updateUserUI();
        populateGuildSelect();
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Fehler beim Laden der Benutzerdaten', 'error');
    } finally {
        showLoading(false);
    }
}

// Update user UI
function updateUserUI() {
    const userAvatar = document.getElementById('userAvatar');
    const username = document.getElementById('username');
    
    if (currentUser.avatar) {
        userAvatar.src = `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png?size=64`;
    } else {
        userAvatar.src = `https://cdn.discordapp.com/embed/avatars/${currentUser.discriminator % 5}.png`;
    }
    
    username.textContent = `${currentUser.username}#${currentUser.discriminator}`;
}

// Populate guild selector
function populateGuildSelect() {
    guildSelect.innerHTML = '<option value="">Server auswählen...</option>';
    
    currentUser.guilds.forEach(guild => {
        const option = document.createElement('option');
        option.value = guild.id;
        option.textContent = guild.name;
        guildSelect.appendChild(option);
    });
}

// Setup event listeners
function setupEventListeners() {
    // Guild selection
    guildSelect.addEventListener('change', onGuildChange);
    
    // Modal controls
    addFeedBtn.addEventListener('click', () => showModal(true));
    closeModal.addEventListener('click', () => showModal(false));
    
    // Click outside modal to close
    addFeedModal.addEventListener('click', (e) => {
        if (e.target === addFeedModal) {
            showModal(false);
        }
    });
    
    // Form submission
    addFeedForm.addEventListener('submit', onAddFeed);
    testFeedBtn.addEventListener('click', onTestFeed);
    
    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            showModal(false);
        }
    });
}

// Guild change handler
async function onGuildChange() {
    const guildId = guildSelect.value;
    
    if (!guildId) {
        currentGuild = null;
        showWelcomeMessage(true);
        return;
    }
    
    currentGuild = guildId;
    showWelcomeMessage(false);
    await loadFeeds();
}

// Show/hide welcome message
function showWelcomeMessage(show) {
    welcomeMessage.style.display = show ? 'block' : 'none';
    dashboardContent.style.display = show ? 'none' : 'block';
}

// Load feeds for current guild
async function loadFeeds(silent = false) {
    if (!currentGuild) return;
    
    try {
        if (!silent) showLoading(true);
        
        const response = await fetch(`/api/feeds/${currentGuild}?t=${Date.now()}`); // Cache-Buster
        
        if (!response.ok) {
            throw new Error('Fehler beim Laden der Feeds');
        }
        
        const newFeeds = await response.json();
        
        // Nur UI updaten wenn sich was geändert hat
        if (!silent || JSON.stringify(feeds) !== JSON.stringify(newFeeds)) {
            feeds = newFeeds;
            updateFeedsUI();
            updateStats();
            
            if (silent) {
                console.log(`🔄 Auto-refresh: ${feeds.length} Feeds geladen`);
            }
        }
    } catch (error) {
        console.error('Error loading feeds:', error);
        if (!silent) {
            showToast('Fehler beim Laden der Feeds', 'error');
        }
    } finally {
        if (!silent) showLoading(false);
    }
}

// Update feeds UI
function updateFeedsUI() {
    if (feeds.length === 0) {
        feedsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-rss"></i>
                <h3>Keine RSS Feeds</h3>
                <p>Füge deinen ersten RSS Feed hinzu, um zu beginnen.</p>
                <button class="btn btn-primary" onclick="showModal(true)">
                    <i class="fas fa-plus"></i>
                    Ersten Feed hinzufügen
                </button>
            </div>
        `;
        return;
    }
    
    feedsList.innerHTML = feeds.map(feed => `
        <div class="feed-item" data-feed-id="${feed.id}">
            <div class="feed-icon">
                <i class="fas fa-rss"></i>
            </div>
            <div class="feed-info">
                <div class="feed-url">${truncateUrl(feed.url, 60)}</div>
                <div class="feed-meta">
                    <span><i class="fas fa-hashtag"></i> Channel: ${feed.channelId}</span>
                    <span><i class="fas fa-bell"></i> ${feed.rolePing ? 'Mit Rolle' : 'Ohne Rolle'}</span>
                    <span><i class="fas fa-clock"></i> ${formatDate(feed.addedAt)}</span>
                    <span><i class="fas fa-${feed.active ? 'check-circle' : 'pause-circle'}"></i> ${feed.active ? 'Aktiv' : 'Pausiert'}</span>
                </div>
            </div>
            <div class="feed-actions">
                <button class="btn btn-small btn-secondary" onclick="toggleFeed('${feed.id}', ${!feed.active})">
                    <i class="fas fa-${feed.active ? 'pause' : 'play'}"></i>
                    ${feed.active ? 'Pausieren' : 'Aktivieren'}
                </button>
                <button class="btn btn-small btn-secondary" onclick="editFeedRole('${feed.id}')">
                    <i class="fas fa-bell"></i>
                    Rolle
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteFeed('${feed.id}')">
                    <i class="fas fa-trash"></i>
                    Löschen
                </button>
            </div>
        </div>
    `).join('');
}

// Update statistics
function updateStats() {
    const totalFeeds = feeds.filter(f => f.active).length;
    const feedsWithRoles = feeds.filter(f => f.rolePing).length;
    
    document.getElementById('totalFeeds').textContent = totalFeeds;
    document.getElementById('feedsWithRoles').textContent = feedsWithRoles;
}

// Show/hide modal
function showModal(show) {
    addFeedModal.style.display = show ? 'block' : 'none';
    
    if (!show) {
        // Reset form
        addFeedForm.reset();
        hideTestResult();
    }
}

// Add feed form submission
async function onAddFeed(e) {
    e.preventDefault();
    
    const formData = {
        url: document.getElementById('feedUrl').value.trim(),
        channelId: document.getElementById('channelId').value.trim(),
        rolePing: document.getElementById('rolePing').value.trim() || null,
        guildId: currentGuild
    };
    
    try {
        showLoading(true);
        const response = await fetch('/api/feeds', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Fehler beim Hinzufügen des Feeds');
        }
        
        showToast('Feed erfolgreich hinzugefügt!', 'success');
        showModal(false);
        await loadFeeds();
    } catch (error) {
        console.error('Error adding feed:', error);
        showToast(error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Test feed
async function onTestFeed() {
    const url = document.getElementById('feedUrl').value.trim();
    
    if (!url) {
        showToast('Bitte gib eine URL ein', 'warning');
        return;
    }
    
    try {
        showLoading(true);
        const response = await fetch('/api/feeds/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Feed-Test fehlgeschlagen');
        }
        
        showTestResult(result);
    } catch (error) {
        console.error('Error testing feed:', error);
        showTestResult(null, error.message);
    } finally {
        showLoading(false);
    }
}

// Show test result
function showTestResult(result, error = null) {
    const testResult = document.getElementById('testResult');
    
    if (error) {
        testResult.innerHTML = `
            <h4>❌ Test fehlgeschlagen</h4>
            <p>${error}</p>
        `;
        testResult.className = 'test-result error';
    } else {
        testResult.innerHTML = `
            <h4>✅ Feed ist gültig</h4>
            <p><strong>Titel:</strong> ${result.title || 'Unbekannt'}</p>
            <p><strong>Items gefunden:</strong> ${result.itemCount}</p>
            ${result.latestItem ? `<p><strong>Letztes Item:</strong> ${result.latestItem.title}</p>` : ''}
        `;
        testResult.className = 'test-result';
    }
    
    testResult.style.display = 'block';
}

// Hide test result
function hideTestResult() {
    const testResult = document.getElementById('testResult');
    testResult.style.display = 'none';
}

// Delete feed
async function deleteFeed(feedId) {
    if (!confirm('Möchtest du diesen Feed wirklich löschen?')) {
        return;
    }
    
    try {
        showLoading(true);
        const response = await fetch(`/api/feeds/${feedId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Fehler beim Löschen des Feeds');
        }
        
        showToast('Feed gelöscht', 'success');
        await loadFeeds();
    } catch (error) {
        console.error('Error deleting feed:', error);
        showToast('Fehler beim Löschen des Feeds', 'error');
    } finally {
        showLoading(false);
    }
}

// Toggle feed active status
async function toggleFeed(feedId, active) {
    try {
        showLoading(true);
        const response = await fetch(`/api/feeds/${feedId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ active })
        });
        
        if (!response.ok) {
            throw new Error('Fehler beim Aktualisieren des Feeds');
        }
        
        showToast(`Feed ${active ? 'aktiviert' : 'pausiert'}`, 'success');
        await loadFeeds();
    } catch (error) {
        console.error('Error toggling feed:', error);
        showToast('Fehler beim Aktualisieren des Feeds', 'error');
    } finally {
        showLoading(false);
    }
}

// Edit feed role
async function editFeedRole(feedId) {
    const feed = feeds.find(f => f.id === feedId);
    if (!feed) return;
    
    const newRole = prompt('Neue Rollen-ID eingeben (leer lassen zum Entfernen):', feed.rolePing || '');
    
    if (newRole === null) return; // Cancelled
    
    try {
        showLoading(true);
        const response = await fetch(`/api/feeds/${feedId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rolePing: newRole.trim() || null })
        });
        
        if (!response.ok) {
            throw new Error('Fehler beim Aktualisieren der Rolle');
        }
        
        showToast('Rollen-Ping aktualisiert', 'success');
        await loadFeeds();
    } catch (error) {
        console.error('Error updating role:', error);
        showToast('Fehler beim Aktualisieren der Rolle', 'error');
    } finally {
        showLoading(false);
    }
}

// Utility functions
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'exclamation-triangle';
    
    toast.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
        <span class="toast-close">&times;</span>
    `;
    
    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });
    
    toastContainer.appendChild(toast);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 5000);
}

function truncateUrl(url, maxLength) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}
