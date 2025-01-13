const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const login = require('ws3-fca'); // Make sure this is installed correctly
const axios = require('axios');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Load commands
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');

const loadCommands = () => {
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        try {
            const command = require(path.join(commandsDir, file));
            if (command.name) {
                commands.set(command.name.toLowerCase(), command);
            } else {
                console.error(`Command file '${file}' is missing a 'name' property.`);
            }
        } catch (error) {
            console.error(`Error loading command '${file}':`, error);
        }
    }
};

loadCommands();
console.log('Commands loaded:', commands);

// Load config
let config = { admins: [] };
try {
    const configRaw = fs.readFileSync('./config.json', 'utf8');
    config = JSON.parse(configRaw);
} catch (error) {
    console.error('Error loading config.json:', error);
    console.warn('Using default config (no admins).');
}

const prefix = '/';
let api = null;
global.userData = {}; // Initialize global userData

const loadUserData = () => {
    try {
        const userDataRaw = fs.readFileSync('./userData.json', 'utf8');
        global.userData = JSON.parse(userDataRaw);
        console.log('User data loaded successfully.');
    } catch (error) {
        console.error('Error loading userData.json:', error);
        console.warn('userData.json not found. Creating a new one.');
    }
};

const saveUserData = () => {
    try {
        const userDataString = JSON.stringify(global.userData, null, 2);
        fs.writeFileSync('./userData.json', userDataString);
        console.log('User data saved successfully.');
    } catch (error) {
        console.error('Error saving userData.json:', error);
    }
};


const loginToFacebook = async () => {
    try {
        api = await new Promise((resolve, reject) => {
            login({}, (err, apiInstance) => { // Remove appState from login
                if (err) reject(err);
                else resolve(apiInstance);
            });
        });
        api.setOptions({ listenEvents: true, selfListen: false });
        console.log('Successfully logged in to Facebook.');
        return api;
    } catch (error) {
        console.error('Fatal error during Facebook login:', error);
        process.exit(1);
    }
};

const startBot = async () => {
    loadUserData(); // Load user data on startup
    api = await loginToFacebook();
    startListeningForMessages();
};

const sendMessage = async (api, messageData) => {
    try {
        const { threadID, message } = messageData;
        if (!message || message.trim() === "") return;
        api.sendMessage(message, threadID, (err) => {
            if (err) console.error("Error sending message:", err);
        });
    } catch (error) {
        console.error("Error in sendMessage:", error);
    }
};

const handleMessage = async (api, event, args, sendMessage) => {
    const { threadID, senderID, body } = event;
    const message = body.toLowerCase();
    const isAdmin = config.admins.includes(senderID);
    const words = message.trim().split(/ +/);
    const commandName = words[0].toLowerCase();

    // Check for the 'prefix' command specifically (no prefix needed)
    if (commandName === 'prefix' && commands.has('prefix')) {
        const command = commands.get('prefix');
        try {
            await command.execute(api, event, words.slice(1), commands, prefix, config.admins, global.userData, sendMessage);
        } catch (error) {
            sendMessage(api, { threadID, message: `Error executing command: ${error.message}` });
        }
    } else if (message.startsWith(prefix)) { // Handle other commands (require prefix)
        const commandName = message.slice(prefix.length).trim().split(/ +/)[0].toLowerCase();
        const command = commands.get(commandName);
        if (command) {
            try {
                await command.execute(api, event, args, commands, prefix, config.admins, global.userData, sendMessage);
            } catch (error) {
                sendMessage(api, { threadID, message: `Error executing command: ${error.message}` });
            }
        } else {
            sendMessage(api, { threadID, message: `Command not found: ${commandName}` });
        }
    } else if (isAdmin) {
        // Handle non-command messages from admins (if needed)
    }
};

const startListeningForMessages = () => {
    api.listenMqtt(async (err, event) => {
        if (err) {
            console.error('Error listening for messages:', err);
            return;
        }
        if (event.type === 'message') {
            const { body, threadID, senderID } = event;
            if (senderID === api.getCurrentUserID()) return;
            const args = body.trim().split(/ +/);
            await handleMessage(api, event, args, sendMessage);
            saveUserData(); // Save user data after each message
        }
    });
};

startBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
