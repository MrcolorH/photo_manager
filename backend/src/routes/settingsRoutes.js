const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readSettings() {
  ensureConfigDir();
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  ensureConfigDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

// 获取主题偏好
router.get('/theme', (req, res) => {
  const settings = readSettings();
  res.json({ theme: settings.theme || 'light' });
});

// 更新主题偏好
router.post('/theme', (req, res) => {
  const { theme } = req.body;
  if (theme !== 'light' && theme !== 'dark') {
    return res.status(400).json({ error: 'theme 必须是 light 或 dark' });
  }
  const settings = readSettings();
  settings.theme = theme;
  writeSettings(settings);
  res.json({ theme });
});

module.exports = router;
