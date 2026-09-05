const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// REPLACE WITH YOUR ACTUAL BOT TOKEN FROM BOTFATHER
const BOT_TOKEN = process.env.BOT_TOKEN || '8805694666:AAHlSXonYbrKWgMO08T4K6PVI2KYzqKKYSg';
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      points REAL DEFAULT 0,
      ads_watched INTEGER DEFAULT 0,
      referred_by TEXT DEFAULT NULL,
      referral_rewarded INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT,
      method TEXT,
      phone TEXT,
      amount_bdt REAL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function verifyTelegramData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Unauthorized' });

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash !== hash) {
    return res.status(403).json({ error: 'Verification failed' });
  }

  try {
    req.user = JSON.parse(urlParams.get('user'));
    req.startParam = urlParams.get('start_param') || null;
  } catch (err) {
    return res.status(400).json({ error: 'User parse error' });
  }

  next();
}

app.get('/api/user', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const username = req.user.username || req.user.first_name || 'User';
  const referrerId = req.startParam && req.startParam !== userId ? req.startParam : null;

  db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });

    if (!row) {
      db.run(
        'INSERT INTO users (telegram_id, username, points, referred_by) VALUES (?, ?, 0, ?)',
        [userId, username, referrerId],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ error: 'Insert error' });
          return res.json({ telegram_id: userId, username, points: 0, ads_watched: 0 });
        }
      );
    } else {
      res.json(row);
    }
  });
});

app.post('/api/reward', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const REWARD_PER_AD = 0.10;
  const REFERRAL_BONUS = 5.00;
  const REQUIRED_ADS = 20;

  db.run(
    'UPDATE users SET points = points + ?, ads_watched = ads_watched + 1 WHERE telegram_id = ?',
    [REWARD_PER_AD, userId],
    function (err) {
      if (err) return res.status(500).json({ error: 'Reward update error' });

      db.get('SELECT ads_watched, referred_by, referral_rewarded FROM users WHERE telegram_id = ?', [userId], (qErr, user) => {
        if (!qErr && user && user.ads_watched >= REQUIRED_ADS && user.referred_by && user.referral_rewarded === 0) {
          db.run('UPDATE users SET points = points + ? WHERE telegram_id = ?', [REFERRAL_BONUS, user.referred_by]);
          db.run('UPDATE users SET referral_rewarded = 1 WHERE telegram_id = ?', [userId]);
        }
      });

      res.json({ success: true, reward: REWARD_PER_AD });
    }
  );
});

app.post('/api/withdraw', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const { method, phone, amount } = req.body;

  if (!['bkash', 'nagad', 'upay'].includes(method)) {
    return res.status(400).json({ error: 'Invalid method' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 50) {
    return res.status(400).json({ error: 'Minimum payout is 50 BDT' });
  }

  db.get('SELECT points FROM users WHERE telegram_id = ?', [userId], (err, row) => {
    if (err || !row) return res.status(500).json({ error: 'User error' });
    if (row.points < numericAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    db.run('UPDATE users SET points = points - ? WHERE telegram_id = ?', [numericAmount, userId], (deductErr) => {
      if (deductErr) return res.status(500).json({ error: 'Deduct error' });

      db.run(
        'INSERT INTO withdrawals (telegram_id, method, phone, amount_bdt) VALUES (?, ?, ?, ?)',
        [userId, method, phone, numericAmount],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ error: 'Queue error' });
          res.json({ success: true, message: 'Submitted' });
        }
      );
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
