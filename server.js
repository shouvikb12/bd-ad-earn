const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// BotFather থেকে পাওয়া টোকেন এখানে বসান
const BOT_TOKEN = process.env.BOT_TOKEN || '8805694666:AAHlSXonYbrKWgMO08T4K6PVI2KYzqKKYSg';
const db = new sqlite3.Database('./database.sqlite');

// ডেটাবেজ টেবিল প্রস্তুত করা
db.serialize(() => {
  // ইউজার টেবিল
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      username TEXT,
      points REAL DEFAULT 0,
      ads_today INTEGER DEFAULT 0,
      last_ad_date TEXT DEFAULT '',
      last_checkin_date TEXT DEFAULT '',
      total_ads INTEGER DEFAULT 0,
      referred_by TEXT DEFAULT NULL,
      referral_rewarded INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // সম্পন্ন করা টাস্ক হিস্ট্রি
  db.run(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT,
      task_id TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_id, task_id)
    )
  `);

  // উইথড্রল রিকোয়েস্ট টেবিল
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

// টেলিগ্রাম ডেটা ভ্যালিডেশন
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
    return res.status(403).json({ error: 'Signature verification failed' });
  }

  try {
    req.user = JSON.parse(urlParams.get('user'));
    req.startParam = urlParams.get('start_param') || null;
  } catch (err) {
    return res.status(400).json({ error: 'Data parsing error' });
  }

  next();
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// আপনি ইচ্ছামতো এখানে নতুন টাস্ক যুক্ত করতে পারবেন
const TASKS = [
  { id: 'task_channel_1', title: 'আমাদের অফিশিয়াল চ্যানেলে জয়েন করুন', link: 'https://t.me/CryptoDropToday', reward: 1.00 },
  { id: 'task_channel_2', title: 'পার্টনার নিউজ চ্যানেলে জয়েন করুন', link: 'https://t.me/telegram', reward: 0.50 },
  { id: 'task_youtube_1', title: 'ইউটিউব চ্যানেল সাবস্ক্রাইব করুন', link: 'https://www.youtube.com/@gaming_craze04', reward: 0.50 }
];

// ১. ব্যবহারকারী প্রোফাইল লোড
app.get('/api/user', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const username = req.user.username || req.user.first_name || 'User';
  const referrerId = req.startParam && req.startParam !== userId ? req.startParam : null;
  const today = getTodayDate();

  db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB Error' });

    if (!row) {
      db.run(
        'INSERT INTO users (telegram_id, username, points, ads_today, last_ad_date, referred_by) VALUES (?, ?, 0, 0, ?, ?)',
        [userId, username, today, referrerId],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ error: 'Insert Error' });
          return res.json({ telegram_id: userId, points: 0, ads_today: 0, can_checkin: true });
        }
      );
    } else {
      let adsToday = row.ads_today;
      if (row.last_ad_date !== today) {
        adsToday = 0;
        db.run('UPDATE users SET ads_today = 0, last_ad_date = ? WHERE telegram_id = ?', [today, userId]);
      }
      const canCheckin = row.last_checkin_date !== today;
      return res.json({ ...row, ads_today: adsToday, can_checkin: canCheckin });
    }
  });
});

// ২. ডেইলি বোনাস ক্লেম (০.৫০ টাকা)
app.post('/api/daily-bonus', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const today = getTodayDate();
  const CHECKIN_REWARD = 0.50;

  db.get('SELECT last_checkin_date FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User error' });
    if (user.last_checkin_date === today) {
      return res.status(400).json({ error: 'আজকের ডেইলি বোনাস আপনি ইতিমধ্যে নিয়ে নিয়েছেন!' });
    }

    db.run(
      'UPDATE users SET points = points + ?, last_checkin_date = ? WHERE telegram_id = ?',
      [CHECKIN_REWARD, today, userId],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ error: 'Bonus update failed' });
        res.json({ success: true, reward: CHECKIN_REWARD });
      }
    );
  });
});

// ৩. অ্যাড রিওয়ার্ড হ্যান্ডলার (প্রতি অ্যাডে ০.০৭৫ টাকা, দৈনিক ২০০ লিমিট)
app.post('/api/reward', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const today = getTodayDate();
  const REWARD_AMOUNT = 0.075; // ২০০টি দেখলে ইউজার পাবে ১৫ টাকা, আপনার লাভ ৫ টাকা
  const DAILY_LIMIT = 200;

  db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User lookup error' });

    let currentAds = user.last_ad_date === today ? user.ads_today : 0;
    if (currentAds >= DAILY_LIMIT) {
      return res.status(400).json({ error: 'আজকের ২০০টি অ্যাডের লিমিট শেষ! কাল আবার চেষ্টা করুন।' });
    }

    const updatedAds = currentAds + 1;
    db.run(
      'UPDATE users SET points = points + ?, ads_today = ?, last_ad_date = ?, total_ads = total_ads + 1 WHERE telegram_id = ?',
      [REWARD_AMOUNT, updatedAds, today, userId],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ error: 'Reward update failed' });

        // রেফারেল কমিশন লজিক: বন্ধু ৪০টি অ্যাড দেখলে রেফারকারী পাবে ১ টাকা
        if (user.total_ads + 1 === 40 && user.referred_by && user.referral_rewarded === 0) {
          db.run('UPDATE users SET points = points + 1.00 WHERE telegram_id = ?', [user.referred_by]);
          db.run('UPDATE users SET referral_rewarded = 1 WHERE telegram_id = ?', [userId]);
        }

        res.json({ success: true, reward: REWARD_AMOUNT, ads_today: updatedAds });
      }
    );
  });
});

// ৪. টাস্ক লিস্ট আনা
app.get('/api/tasks', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  db.all('SELECT task_id FROM completed_tasks WHERE telegram_id = ?', [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const completedIds = rows.map((r) => r.task_id);
    const taskList = TASKS.map((t) => ({
      ...t,
      completed: completedIds.includes(t.id)
    }));
    res.json(taskList);
  });
});

// ৫. টাস্ক সাবমিট ও রিওয়ার্ড
app.post('/api/claim-task', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const { task_id } = req.body;
  const task = TASKS.find((t) => t.id === task_id);

  if (!task) return res.status(400).json({ error: 'ভুল টাস্ক নির্বাচন' });

  db.run('INSERT INTO completed_tasks (telegram_id, task_id) VALUES (?, ?)', [userId, task_id], function (err) {
    if (err) {
      return res.status(400).json({ error: 'আপনি ইতিমধ্যে এই টাস্কটি পূরণ করেছেন!' });
    }

    db.run('UPDATE users SET points = points + ? WHERE telegram_id = ?', [task.reward, userId], (upErr) => {
      if (upErr) return res.status(500).json({ error: 'Reward error' });
      res.json({ success: true, reward: task.reward });
    });
  });
});

// ৬. উইথড্রল রিকোয়েস্ট (মিনিমাম ১০ টাকা)
app.post('/api/withdraw', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const { method, phone, amount } = req.body;

  if (!['bkash', 'nagad', 'upay'].includes(method)) {
    return res.status(400).json({ error: 'পেমেন্ট মাধ্যম সঠিক নয়' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 10) {
    return res.status(400).json({ error: 'সর্বনিম্ন উত্তোলন ১০ টাকা' });
  }

  db.get('SELECT points FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User lookup failed' });
    if (user.points < numericAmount) {
      return res.status(400).json({ error: 'পর্যাপ্ত ব্যালেন্স নেই' });
    }

    db.run('UPDATE users SET points = points - ? WHERE telegram_id = ?', [numericAmount, userId], (deductErr) => {
      if (deductErr) return res.status(500).json({ error: 'Balance deduction failed' });

      db.run(
        'INSERT INTO withdrawals (telegram_id, method, phone, amount_bdt) VALUES (?, ?, ?, ?)',
        [userId, method, phone, numericAmount],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ error: 'Queue error' });
          res.json({ success: true, message: 'উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে!' });
        }
      );
    });
  });
});

// ৭. ইউজার ইন্টারফেস (HTML)
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>BD Ad Earn</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>

  <!-- ভবিষ্যতে Adsgram যোগ করার জায়গা -->
  <!-- <script src="https://sad.adsgram.ai/js/sad.min.js"></script> -->

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
    .header { text-align: center; padding: 4px 0; }
    .header h1 { font-size: 20px; color: #48cae4; }
    .card {
      background: #1c2541;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid #3a506b;
    }
    .balance-label { font-size: 13px; color: #90e0ef; }
    .balance-num { font-size: 32px; font-weight: bold; margin: 4px 0; color: #00f5d4; }
    .stats { font-size: 13px; color: #cbd5e1; margin-bottom: 10px; }
    button {
      width: 100%;
      padding: 11px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
    }
    .btn-ad { background: #00b4d8; color: #fff; }
    .btn-bonus { background: #10b981; color: #fff; margin-bottom: 8px; }
    .btn-withdraw { background: #2ec4b6; color: #0b132b; margin-top: 10px; }
    .btn-copy { background: #ffb703; color: #000; margin-top: 8px; }
    .btn-task { background: #3b82f6; color: #fff; padding: 8px 12px; font-size: 12px; width: auto; }
    .task-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #334155;
    }
    .task-item:last-child { border-bottom: none; }
    .task-info { max-width: 65%; font-size: 13px; }
    .task-reward { color: #00f5d4; font-weight: bold; font-size: 12px; }
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
    .note { font-size: 11px; color: #94a3b8; margin-top: 6px; line-height: 1.4; }
  </style>
</head>
<body>

  <div class="header">
    <h1>বিডি অ্যাড আর্ন (BD Ad Earn)</h1>
  </div>

  <div class="card" style="text-align: center;">
    <div class="balance-label">মোট ব্যালেন্স</div>
    <div class="balance-num"><span id="balance">0.00</span> ৳</div>
    <div class="stats">আজকের অ্যাড: <span id="adCount">0</span> / 200 টি</div>
    
    <button class="btn-bonus" id="checkinBtn" onclick="claimDailyBonus()">🎁 ডেইলি চেক-ইন বোনাস (+০.৫০ ৳)</button>
    <button class="btn-ad" onclick="triggerAd()">📺 ভিডিও অ্যাড দেখুন (+০.০৭৫ ৳)</button>
  </div>

  <!-- স্পনসরড টাস্ক সেকশন -->
  <div class="card">
    <h3 style="font-size: 15px; color: #48cae4; margin-bottom: 8px;">📋 স্পনসরড টাস্ক</h3>
    <div id="taskList">টাস্ক লোড হচ্ছে...</div>
  </div>

  <div class="card">
    <h3 style="font-size: 15px; color: #ffb703;">🎁 রেফার লিংক (১ ৳ বোনাস)</h3>
    <p class="note">শর্ত: বন্ধু আপনার রেফার লিংকে এসে ৪০টি অ্যাড দেখলে আপনি ১ টাকা কমিশন পাবেন।</p>
    <input type="text" id="refLink" readonly />
    <button class="btn-copy" onclick="copyLink()">রেফার লিংক কপি করুন</button>
  </div>

  <div class="card">
    <h3 style="font-size: 15px; color: #2ec4b6;">💸 টাকা উত্তোলন (মিনিমাম ১০ ৳)</h3>
    <select id="method">
      <option value="bkash">বিকাশ (Personal)</option>
      <option value="nagad">নগদ (Personal)</option>
      <option value="upay">উপায় (Personal)</option>
    </select>
    <input type="tel" id="phone" placeholder="নম্বর লিখুন (০১xxxxxxxxx)" />
    <input type="number" id="amount" placeholder="টাকার পরিমাণ (মিনিমাম ১০)" />
    <button class="btn-withdraw" onclick="submitWithdraw()">উত্তোলন রিকোয়েস্ট পাঠান</button>
    <p class="note">পেমেন্ট রিকোয়েস্টের ২৪-৪৮ ঘণ্টার মধ্যে ম্যানুয়ালি যাচাই করে পাঠানো হয়।</p>
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
          document.getElementById('adCount').innerText = data.ads_today || 0;
          if (!data.can_checkin) {
            const btn = document.getElementById('checkinBtn');
            btn.innerText = '✅ আজকের বোনাস নেওয়া শেষ';
            btn.style.opacity = '0.5';
            btn.disabled = true;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    async function loadTasks() {
      try {
        const res = await fetch('/api/tasks', {
          headers: { 'x-telegram-init-data': initData }
        });
        const tasks = await res.json();
        const container = document.getElementById('taskList');
        container.innerHTML = '';

        tasks.forEach(task => {
          const div = document.createElement('div');
          div.className = 'task-item';
          div.innerHTML = \`
            <div class="task-info">
              <div>\${task.title}</div>
              <div class="task-reward">+\${parseFloat(task.reward).toFixed(2)} ৳</div>
            </div>
            <div>
              \${task.completed 
                ? '<span style="color:#10b981;font-size:12px;font-weight:bold;">সম্পন্ন ✓</span>' 
                : \`<button class="btn-task" onclick="doTask('\${task.id}', '\${task.link}')">সম্পন্ন করুন</button>\`}
            </div>
          \`;
          container.appendChild(div);
        });
      } catch (e) {
        console.error(e);
      }
    }

    function doTask(taskId, link) {
      if (tg && tg.openLink) {
        tg.openLink(link);
      } else {
        window.open(link, '_blank');
      }

      setTimeout(async () => {
        try {
          const res = await fetch('/api/claim-task', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-telegram-init-data': initData
            },
            body: JSON.stringify({ task_id: taskId })
          });
          const data = await res.json();
          if (data.success) {
            alert('টাস্ক সম্পন্ন হয়েছে! +' + data.reward + ' টাকা যোগ করা হয়েছে।');
            syncUserData();
            loadTasks();
          } else {
            alert(data.error);
          }
        } catch (e) {
          alert('সার্ভার সমস্যা');
        }
      }, 4000);
    }

    async function claimDailyBonus() {
      try {
        const res = await fetch('/api/daily-bonus', {
          method: 'POST',
          headers: { 'x-telegram-init-data': initData }
        });
        const data = await res.json();
        if (data.success) {
          alert('অভিনন্দন! ডেইলি বোনাস (+০.৫০ টাকা) যোগ হয়েছে।');
          syncUserData();
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('সার্ভার সমস্যা');
      }
    }

    // অ্যাড ফাংশন (ভবিষ্যতে আসল Adsgram কোড এখানে বসাবেন)
    function triggerAd() {
      claimReward();
    }

    async function claimReward() {
      try {
        const res = await fetch('/api/reward', {
          method: 'POST',
          headers: { 'x-telegram-init-data': initData }
        });
        const data = await res.json();
        if (data.success) {
          syncUserData();
        } else {
          alert(data.error || 'অ্যাড দেখা সম্ভব হয়নি');
        }
      } catch (e) {
        alert('সার্ভার সমস্যা');
      }
    }

    async function submitWithdraw() {
      const method = document.getElementById('method').value;
      const phone = document.getElementById('phone').value.trim();
      const amount = parseFloat(document.getElementById('amount').value);

      if (!phone || isNaN(amount)) return alert('সঠিক তথ্য দিন।');
      if (amount < 10) return alert('সর্বনিম্ন উত্তোলন ১০ টাকা।');

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
          alert('উত্তোলন রিকোয়েস্ট সফল হয়েছে!');
          syncUserData();
          document.getElementById('phone').value = '';
          document.getElementById('amount').value = '';
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
    loadTasks();
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
