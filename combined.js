// combined.js - Beide Services in einem Prozess
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting RSScord Combined Services...');

// Discord Bot starten
console.log('🤖 Starting Discord Bot...');
const botProcess = spawn('node', ['bot.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

botProcess.on('error', (error) => {
    console.error('❌ Bot Process Error:', error);
});

botProcess.on('exit', (code) => {
    console.log(`🤖 Bot Process exited with code ${code}`);
    if (code !== 0) {
        console.log('🔄 Restarting bot in 5 seconds...');
        setTimeout(() => {
            spawn('node', ['bot.js'], { stdio: 'inherit', cwd: __dirname });
        }, 5000);
    }
});

// Web Interface starten
console.log('🌐 Starting Web Interface...');
const webProcess = spawn('node', ['web.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

webProcess.on('error', (error) => {
    console.error('❌ Web Process Error:', error);
});

webProcess.on('exit', (code) => {
    console.log(`🌐 Web Process exited with code ${code}`);
    if (code !== 0) {
        console.log('🔄 Restarting web interface in 5 seconds...');
        setTimeout(() => {
            spawn('node', ['web.js'], { stdio: 'inherit', cwd: __dirname });
        }, 5000);
    }
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('📴 Shutting down services...');
    botProcess.kill();
    webProcess.kill();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📴 Shutting down services...');
    botProcess.kill();
    webProcess.kill();
    process.exit(0);
});

// Keep the main process alive
setInterval(() => {
    // Health check - restart if processes are dead
    if (botProcess.killed) {
        console.log('🔄 Bot process died, restarting...');
        spawn('node', ['bot.js'], { stdio: 'inherit', cwd: __dirname });
    }
    if (webProcess.killed) {
        console.log('🔄 Web process died, restarting...');
        spawn('node', ['web.js'], { stdio: 'inherit', cwd: __dirname });
    }
}, 30000); // Check every 30 seconds
