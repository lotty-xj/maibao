const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Read data
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading data:', e.message);
  }
  return getDefaultData();
}

// Write data with debounce
let writeTimeout = null;
function writeData(data, immediate = false) {
  data._lastModified = new Date().toISOString();
  data._version = (data._version || 0) + 1;
  
  const doWrite = () => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error writing data:', e.message);
    }
  };
  
  if (immediate) {
    clearTimeout(writeTimeout);
    doWrite();
  } else {
    clearTimeout(writeTimeout);
    writeTimeout = setTimeout(doWrite, 300);
  }
}

function getDefaultData() {
  return {
    _version: 0,
    _lastModified: new Date().toISOString(),
    _activityLog: [],
    baby: {
      name: '麦宝',
      birthDate: '',
      gender: '',
      weight: '',
      height: '',
      currentMember: ''
    },
    members: [],
    feedingRecords: [],
    supplementRecords: [],
    poopRecords: [],
    growthRecords: [],
    milestones: [],
    vaccineRecords: [],
    healthChecks: [],
    educationRecords: [],
    bilingualActivities: [],
    settings: { supplementAlternate: true }
  };
}

// Activity log
function addActivity(data, type, detail, userName) {
  if (!data._activityLog) data._activityLog = [];
  data._activityLog.unshift({
    type, detail, user: userName || data.baby.currentMember || '家人',
    time: new Date().toISOString()
  });
  if (data._activityLog.length > 100) data._activityLog = data._activityLog.slice(0, 100);
}

// ========== API Routes ==========

// Get all data
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json({ success: true, version: data._version, lastModified: data._lastModified, data });
});

// Check version (lightweight poll)
app.get('/api/version', (req, res) => {
  const data = readData();
  res.json({ version: data._version, lastModified: data._lastModified });
});

// Full sync (client sends all data)
app.post('/api/sync', (req, res) => {
  const clientData = req.body;
  if (!clientData || !clientData.baby) {
    return res.json({ success: false, error: 'Invalid data' });
  }
  
  const serverData = readData();
  
  // Merge strategy: client data overwrites server data
  // but preserve fields that the server has and client doesn't
  const merged = { ...serverData, ...clientData };
  merged._version = Math.max(serverData._version || 0, clientData._version || 0);
  merged._activityLog = serverData._activityLog || [];
  
  writeData(merged, true);
  
  // Broadcast to polling clients that data changed
  broadcastUpdate();
  
  res.json({ success: true, version: merged._version, lastModified: merged._lastModified });
});

// Add feeding record
app.post('/api/feeding', (req, res) => {
  const data = readData();
  const record = req.body;
  record.id = 'feed_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  if (!record.date) record.date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  data.feedingRecords.push(record);
  addActivity(data, 'feeding', `${record.type === 'breastmilk' ? '母乳' : record.type === 'formula' ? '配方奶' : '辅食'} ${record.amount || record.food || ''}`, record.recordedBy);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, id: record.id, version: data._version });
});

// Add poop record
app.post('/api/poop', (req, res) => {
  const data = readData();
  const record = req.body;
  record.id = 'poop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  if (!record.date) record.date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  if (!data.poopRecords) data.poopRecords = [];
  data.poopRecords.push(record);
  addActivity(data, 'poop', `${record.quality} · ${record.color}`, record.recordedBy);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, id: record.id, version: data._version });
});

// Add supplement record
app.post('/api/supplement', (req, res) => {
  const data = readData();
  const record = req.body;
  record.id = 'sup_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  if (!record.date) record.date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  data.supplementRecords.push(record);
  addActivity(data, 'supplement', `补剂：${record.type}`, record.recordedBy);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, id: record.id, version: data._version });
});

// Add growth record
app.post('/api/growth', (req, res) => {
  const data = readData();
  const record = req.body;
  record.id = 'growth_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  
  const existing = data.growthRecords.find(r => r.date === record.date);
  if (existing) {
    if (record.weight) existing.weight = record.weight;
    if (record.height) existing.height = record.height;
  } else {
    data.growthRecords.push(record);
  }
  addActivity(data, 'growth', `身高体重记录`, record.recordedBy);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

// Add milestone
app.post('/api/milestone', (req, res) => {
  const data = readData();
  const record = req.body;
  record.id = 'ms_' + Date.now();
  if (!data.milestones) data.milestones = [];
  data.milestones.push(record);
  addActivity(data, 'milestone', `里程碑：${record.name}`, record.recordedBy || data.baby.currentMember);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, id: record.id, version: data._version });
});

// Update vaccine
app.patch('/api/vaccine/:id', (req, res) => {
  const data = readData();
  const idx = data.vaccineRecords.findIndex(v => v.id === req.params.id);
  if (idx >= 0) {
    Object.assign(data.vaccineRecords[idx], req.body);
    if (req.body.completed) {
      addActivity(data, 'vaccine', `完成接种：${data.vaccineRecords[idx].name}`, data.baby.currentMember);
    }
    writeData(data);
    broadcastUpdate();
    return res.json({ success: true, version: data._version });
  }
  res.status(404).json({ success: false, error: 'Vaccine not found' });
});

// Update health check
app.patch('/api/health/:id', (req, res) => {
  const data = readData();
  if (!data.healthChecks) data.healthChecks = [];
  const idx = data.healthChecks.findIndex(h => h.id === req.params.id);
  if (idx >= 0) {
    Object.assign(data.healthChecks[idx], req.body);
    if (req.body.completed) {
      addActivity(data, 'health', `完成儿保：${data.healthChecks[idx].name}`, data.baby.currentMember);
    }
    writeData(data);
    broadcastUpdate();
    return res.json({ success: true, version: data._version });
  }
  res.status(404).json({ success: false, error: 'Health check not found' });
});

// Toggle education check-in
app.patch('/api/education/:id', (req, res) => {
  const data = readData();
  const record = data.educationRecords.find(r => r.id === req.params.id);
  if (record) {
    record.done = req.body.done !== undefined ? req.body.done : !record.done;
    addActivity(data, 'education', `${record.done ? '✅' : '⏳'} ${record.name}`, data.baby.currentMember);
    writeData(data);
    broadcastUpdate();
    return res.json({ success: true, done: record.done, version: data._version });
  }
  res.status(404).json({ success: false, error: 'Activity not found' });
});

// Update baby info
app.patch('/api/baby', (req, res) => {
  const data = readData();
  Object.assign(data.baby, req.body);
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

// Update members
app.patch('/api/members', (req, res) => {
  const data = readData();
  data.members = req.body.members || data.members;
  if (req.body.currentMember) data.baby.currentMember = req.body.currentMember;
  writeData(data);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

// Get recent activity
app.get('/api/activity', (req, res) => {
  const data = readData();
  res.json({ success: true, activities: (data._activityLog || []).slice(0, 20) });
});

// ========== SSE for Real-time Updates ==========
let sseClients = [];

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  res.write('data: {"type":"connected"}\n\n');
  
  sseClients.push(res);
  
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

function broadcastUpdate() {
  const data = readData();
  const msg = JSON.stringify({ type: 'update', version: data._version });
  sseClients.forEach(client => {
    try { client.write(`data: ${msg}\n\n`); } catch (e) {}
  });
}

// Delete records
app.delete('/api/feeding/:id', (req, res) => {
  const data = readData();
  data.feedingRecords = data.feedingRecords.filter(r => r.id !== req.params.id);
  writeData(data, true);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

app.delete('/api/poop/:id', (req, res) => {
  const data = readData();
  data.poopRecords = data.poopRecords.filter(r => r.id !== req.params.id);
  writeData(data, true);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

app.delete('/api/supplement/:id', (req, res) => {
  const data = readData();
  data.supplementRecords = data.supplementRecords.filter(r => r.id !== req.params.id);
  writeData(data, true);
  broadcastUpdate();
  res.json({ success: true, version: data._version });
});

// Health check
app.get('/api/health-check', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), clients: sseClients.length });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🐣  麦宝的成长日记 - 服务器已启动');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  本地访问:  http://localhost:${PORT}`);
  console.log(`  局域网访问:  http://<本机IP>:${PORT}`);
  console.log(`  数据文件:  ${DATA_FILE}`);
  console.log('  支持多人协作，数据实时同步');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // Print local IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  📡 ${name}: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
