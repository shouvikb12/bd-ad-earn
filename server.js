const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Replace with your real bot token from BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
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

// Middleware: Validate Telegram WebApp Data
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

// 1. Direct Root Route Serving the UI
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>BD Ad Earn</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b132b;
      color: #ffffff;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .header { text-align: center; padding: 6px 0; }
    .header h1 { font-size: 20px; color: #48cae4; }
    .card {
      background: #1c2541;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      border: 1px solid #3a506b;
    }
    .balance-label { font-size: 13px; color: #90e0ef; }
    .balance-num { font-size: 32px; font-weight: bold; margin: 6px 0; color: #00f5d4; }
    .stats { font-size: 12px; color: #a0aec0; margin-bottom: 12px; }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-ad { background: #00b4d8; color: #fff; }
    .btn-withdraw { background: #2ec4b6; color: #0b132b; margin-top: 10px; }
    .btn-copy { background: #ffb703; color: #000; margin-top: 8px; }
    input, select {
      width: 100%;
      padding: 10px;
      margin-top: 8px;
      border-radius: 6px;
      border: 1px solid #4a5568;
      background: #0b132b;
      color: #fff;
      font-size: 14px;
    }
    .note { font-size: 11px; color: #cbd5e1; margin-top: 6px; line-height: 1.4; }
  </style>
</head>
<body>

  <div class="header">
    <h1>বিডি অ্যাড আর্ন (BD Ad Earn)</h1>
  </div>

  <div class="card" style="text-align: center;">
    <div class="balance-label">বর্তমান ব্যালেন্স</div>
    <div class="balance-num"><span id="balance">0.00</span> ৳</div>
    <div class="stats">দেখা মোট অ্যাড: <span id="adCount">0</span> টি</div>
    <button class="btn-ad" onclick="playAd()">📺 অ্যাড দেখুন (+০.১০ ৳)</button>
  </div>

  <div class="card">
    <h3 style="font-size: 15px; color: #ffb703;">🎁 রেফার বোনাস (৫ ৳)</h3>
    <p class="note">শর্ত: বন্ধু আপনার লিংকে জয়েন করে <b>২০টি অ্যাড</b> দেখলে আপনি ৫ টাকা পাবেন।</p>
    <input type="text" id="refLink" readonly />
    <button class="btn-copy" onclick="copyLink()">রেফার লিংক কপি করুন</button>
  </div>

  <div class="card">
    <h3 style="font-size: 15px; color: #2ec4b6;">💸 টাকা উত্তোলন (মিনিমাম ৫০ ৳)</h3>
    <select id="method">
      <option value="bkash">বিকাশ (Personal)</option>
      <option value="nagad">নগদ (Personal)</option>
      <option value="upay">উপায় (Personal)</option>
    </select>
    <input type="tel" id="phone" placeholder="নম্বর লিখুন (০১xxxxxxxxx)" />
    <input type="number" id="amount" placeholder="টাকার পরিমাণ (মিনিমাম ৫০)" />
    <button class="btn-withdraw" onclick="submitWithdraw()">উত্তোলন রিকোয়েস্ট পাঠান</button>
    <p class="note">রিকোয়েস্টের ২৪-৪৮ ঘণ্টার মধ্যে ম্যানুয়ালি যাচাই করে পেমেন্ট পাঠানো হয়।</p>
  </div>

  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) tg.expand();

    const initData = tg?.initData || '';
    const userId = tg?.initDataUnsafe?.user?.id || 'demo';
    const BOT_USERNAME = 'BDAdEarnOfficial_bot'; 
    document.getElementById('refLink').value = 'https://t.me/' + BOT_USERNAME + '?start=' + userId;

    async function syncUserData() {
      try {
        const res = await fetch('/api/user', {
          headers: { 'x-telegram-init-data': initData }
        });
        const data = await res.json();
        if (data.points !== undefined) {
          document.getElementById('balance').innerText = parseFloat(data.points).toFixed(2);
          document.getElementById('adCount').innerText = data.ads_watched || 0;
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function playAd() {
      try {
        const res = await fetch('/api/reward', {
          method: 'POST',
          headers: { 'x-telegram-init-data': initData }
        });
        const data = await res.json();
        if (data.success) syncUserData();
      } catch (e) {
        alert('অ্যাড লোড হয়নি, আবার চেষ্টা করুন।');
      }
    }

    async function submitWithdraw() {
      const method = document.getElementById('method').value;
      const phone = document.getElementById('phone').value.trim();
      const amount = parseFloat(document.getElementById('amount').value);

      if (!phone || isNaN(amount)) return alert('সঠিক তথ্য দিন।');
      if (amount < 50) return alert('সর্বনিম্ন উত্তোলন ৫০ টাকা।');

      try {
        const res = await fetch('/api/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-telegram-init-data': initData
          },
          body: JSON.stringify({ method, phone, amount })
        });
        const data = await res.json();
        if (data.success) {
          alert('রিকোয়েস্ট সফল হয়েছে!');
          syncUserData();
        } else {
          alert(data.error || 'ব্যর্থ হয়েছে');
        }
      } catch (e) {
        alert('সার্ভার সমস্যা');
      }
    }

    function copyLink() {
      const copyText = document.getElementById('refLink');
      navigator.clipboard.writeText(copyText.value);
      alert('রেফার লিংক কপি হয়েছে!');
    }

    syncUserData();
  </script>
</body>
</html>`);
});

// API Routes
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
