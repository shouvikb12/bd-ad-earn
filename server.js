const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// অ্যাডমিন পাসওয়ার্ড (/admin এ ঢোকার জন্য)
const ADMIN_PASSWORD = "adminpass123";

const db = new sqlite3.Database('./database.sqlite');

// ডেটাবেজ স্কিমা তৈরি
db.serialize(() => {
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

  db.run(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT,
      task_id TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(telegram_id, task_id)
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

// টেলিগ্রাম ইউজার ভ্যালিডেশন মিডলওয়্যার (কোনো সিগনেচার হ্যাশ এরর দেবে না)
function verifyTelegramData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    return res.status(401).json({ error: 'Unauthorized: টেলিগ্রাম থেকে অ্যাপ খুলুন' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');

    if (!userStr) {
      return res.status(400).json({ error: 'ইউজার ডেটা পাওয়া যায়নি' });
    }

    req.user = JSON.parse(userStr);
    req.startParam = urlParams.get('start_param') || null;
    next();
  } catch (err) {
    return res.status(400).json({ error: 'ইউজার ডেটা পার্স ত্রুটি' });
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// সোশ্যাল টাস্ক
const TASKS = [
  { id: 'task_channel_1', title: 'আমাদের অফিশিয়াল চ্যানেলে জয়েন করুন', link: 'https://t.me/CryptoDropToday', reward: 1.00 },
  { id: 'task_channel_2', title: 'পার্টনার টেলিগ্রাম গ্রুপে জয়েন করুন', link: 'https://t.me/telegram', reward: 0.50 },
  { id: 'task_youtube_1', title: 'ইউটিউব চ্যানেল সাবস্ক্রাইব করুন', link: 'https://youtube.com/@gaming_craze04', reward: 0.50 }
];

// ====================================================================
// ১. রুট (Root) পাথ: সরাসরি ফ্রন্টএন্ড UI
// ====================================================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>BD Ad Earn</title>
  
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://sad.adsgram.ai/js/sad.min.js"></script>

  <style>
    :root {
      --bg-primary: #0a0f1d;
      --card-bg: #131c31;
      --card-border: #1e2942;
      --accent-cyan: #00d2ff;
      --accent-blue: #3a7bd5;
      --accent-green: #10b981;
      --accent-amber: #f59e0b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-main);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      line-height: 1.5;
    }
    .top-header { display: flex; align-items: center; justify-content: space-between; padding: 4px; }
    .brand-title {
      font-size: 18px;
      font-weight: 700;
      background: linear-gradient(90deg, #00d2ff, #3a7bd5);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge-live {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 20px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      font-weight: 600;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 16px;
    }
    .balance-card {
      text-align: center;
      background: linear-gradient(180deg, #16223d 0%, #111a2e 100%);
    }
    .balance-title { font-size: 12px; color: var(--text-muted); text-transform: uppercase; }
    .balance-value { font-size: 34px; font-weight: 800; color: #38bdf8; margin: 4px 0 8px; }
    .progress-bar-bg { width: 100%; height: 6px; background: #1e293b; border-radius: 10px; overflow: hidden; margin: 6px 0; }
    .progress-fill { width: 0%; height: 100%; background: linear-gradient(90deg, #00d2ff, #10b981); transition: width 0.3s; }
    .progress-label { font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-bonus { background: linear-gradient(135deg, #059669, #10b981); color: #fff; margin-bottom: 8px; }
    .btn-ad { background: linear-gradient(135deg, #0284c7, #00d2ff); color: #fff; }
    .btn-withdraw { background: linear-gradient(135deg, #10b981, #059669); color: #fff; margin-top: 10px; }
    .btn-copy { background: #f59e0b; color: #000; margin-top: 8px; }
    .card-heading { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
    .task-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .task-item:last-child { border-bottom: none; }
    .task-name { font-size: 13px; font-weight: 600; }
    .task-reward { font-size: 12px; color: #38bdf8; font-weight: bold; }
    .btn-task-action { background: #1e293b; color: #fff; border: 1px solid #334155; padding: 6px 12px; font-size: 12px; width: auto; }
    input, select {
      width: 100%;
      padding: 10px;
      margin-top: 6px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: #0d1527;
      color: #fff;
      font-size: 13px;
    }
    .hint-text { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
  </style>
</head>
<body>

  <div class="top-header">
    <div class="brand-title">🇧🇩 BD Ad Earn</div>
    <div class="badge-live">● অনলাইন</div>
  </div>

  <div class="card balance-card">
    <div class="balance-title">মোট ব্যালেন্স</div>
    <div class="balance-value"><span id="balance">0.00</span> ৳</div>

    <div style="margin-bottom: 14px;">
      <div class="progress-bar-bg">
        <div class="progress-fill" id="progressFill"></div>
      </div>
      <div class="progress-label">
        <span>দৈনিক অ্যাড কোটা</span>
        <span><b id="adCount">0</b> / 200 সম্পন্ন</span>
      </div>
    </div>

    <button class="btn-bonus" id="checkinBtn" onclick="claimDailyBonus()">🎁 ডেইলি বোনাস নিন (+০.৫০ ৳)</button>
    <button class="btn-ad" id="adBtn" onclick="triggerAd()">📺 ভিডিও অ্যাড দেখুন (+০.০৭৫ ৳)</button>
  </div>

  <div class="card">
    <div class="card-heading">📋 সোশ্যাল টাস্ক</div>
    <div id="taskList"><div style="font-size: 12px; color: var(--text-muted);">টাস্ক লোড হচ্ছে...</div></div>
  </div>

  <div class="card">
    <div class="card-heading" style="color: #f59e0b;">👥 রেফার বোনাস (১.০০ ৳)</div>
    <p class="hint-text">বন্ধু রেফার লিংকে যুক্ত হয়ে <b>৪০টি অ্যাড</b> দেখলে আপনার ব্যালেন্সে ১ টাকা বোনাস সরাসরি যোগ হবে।</p>
    <input type="text" id="refLink" readonly />
    <button class="btn-copy" onclick="copyLink()">🔗 রেফার লিংক কপি করুন</button>
  </div>

  <div class="card">
    <div class="card-heading" style="color: #00d2ff;">💳 টাকা উত্তোলন (মিনিমাম ১০ ৳)</div>
    <select id="method">
      <option value="bkash">বিকাশ (Personal)</option>
      <option value="nagad">নগদ (Personal)</option>
      <option value="upay">উপায় (Personal)</option>
    </select>
    <input type="tel" id="phone" placeholder="মোবাইল নম্বর লিখুন (০১xxxxxxxxx)" />
    <input type="number" id="amount" placeholder="পরিমাণ লিখুন (মিনিমাম ১০ ৳)" />
    <button class="btn-withdraw" onclick="submitWithdraw()">উত্তোলন অনুরোধ পাঠান</button>
    <p class="hint-text">অনুরোধের ২৪-৪৮ ঘণ্টার মধ্যে ম্যানুয়ালি যাচাই করে পেমেন্ট সম্পন্ন করা হয়।</p>
  </div>

  <script>
    var BOT_USERNAME = 'BDAdEarnBot'; 
    var ADSGRAM_BLOCK_ID = '46321'; 

    var tg = window.Telegram ? window.Telegram.WebApp : null;
    if (tg) { 
      try { tg.expand(); tg.ready(); } catch(e) {}
    }

    var initData = (tg && tg.initData) ? tg.initData : '';
    var userId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.id : 'demo';

    var refInput = document.getElementById('refLink');
    if (refInput) {
      refInput.value = 'https://t.me/' + BOT_USERNAME + '/app?startapp=' + userId;
    }

    function syncUserData() {
      fetch('/api/user', { headers: { 'x-telegram-init-data': initData } })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.points !== undefined) {
            document.getElementById('balance').innerText = parseFloat(data.points).toFixed(2);
            var ads = data.ads_today || 0;
            document.getElementById('adCount').innerText = ads;
            document.getElementById('progressFill').style.width = Math.min((ads / 200) * 100, 100) + '%';

            if (!data.can_checkin) {
              var btn = document.getElementById('checkinBtn');
              btn.innerText = '✅ আজকের বোনাস নেওয়া শেষ';
              btn.disabled = true;
            }
          }
        })
        .catch(function(err) { console.error(err); });
H'  }

    function triggerAd() {
      var adBtn = document.getElementById('adBtn');

      if (window.Adsgram) {
        var AdController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
        AdController.show()
          .then(function() {
            // পুরো ভিডিও শেষ হলে রিওয়ার্ড পাবে
            claimReward();
            startAdCooldown(adBtn);
          })
          .catch(function(err) {
            alert('পুরো ভিডিও বিজ্ঞাপনটি দেখলে তবেই রিওয়ার্ড পাবেন!');
          });
      } else {
        alert('অ্যাড সার্ভার লোড হচ্ছে, কয়েক সেকেন্ড পর আবার চেষ্টা করুন।');
      }
    }

    function startAdCooldown(btn) {
      var seconds = 5;
      btn.disabled = true;
      var originalText = btn.innerText;

      var timer = setInterval(function() {
        btn.innerText = '⏳ অপেক্ষা করুন (' + seconds + 's)';
        seconds--;
        if (seconds < 0) {
          clearInterval(timer);
          btn.disabled = false;
          btn.innerText = originalText;
        }
      }, 1000);
    }

    function claimReward() {
      fetch('/api/reward', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData }
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          syncUserData();
        } else {
          alert(data.error || 'অ্যাড দেখা সম্ভব হয়নি');
        }
      })
      .catch(function() { alert('সার্ভার সমস্যা'); });
    }

    function claimDailyBonus() {
      fetch('/api/daily-bonus', {
        method: 'POST',
        headers: { 'x-telegram-init-data': initData }
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          alert('অভিনন্দন! ডেইলি বোনাস (+০.৫০ ৳) যোগ হয়েছে।');
          syncUserData();
        } else { 
          alert(data.error); 
        }
      })
      .catch(function() { alert('সার্ভার সমস্যা'); });
    }

    function loadTasks() {
      fetch('/api/tasks', { headers: { 'x-telegram-init-data': initData } })
        .then(function(res) { return res.json(); })
        .then(function(tasks) {
          var container = document.getElementById('taskList');
          container.innerHTML = '';

          tasks.forEach(function(task) {
            var div = document.createElement('div');
            div.className = 'task-item';

            var rightHtml = task.completed 
              ? '<span style="color:#10b981;font-size:12px;font-weight:bold;">✓ সম্পন্ন</span>' 
              : '<button class="btn-task-action" onclick="doTask(\\'' + task.id + '\\', \\'' + task.link + '\\')">শুরু করুন</button>';

            div.innerHTML = '<div>' +
              '<div class="task-name">' + task.title + '</div>' +
              '<div class="task-reward">+' + parseFloat(task.reward).toFixed(2) + ' ৳</div>' +
              '</div><div>' + rightHtml + '</div>';

            container.appendChild(div);
          });
        })
        .catch(function(err) { console.error(err); });
    }

    function doTask(taskId, link) {
      if (tg && tg.openLink) {
        tg.openLink(link);
      } else {
        window.open(link, '_blank');
      }

      setTimeout(function() {
        fetch('/api/claim-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ task_id: taskId })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.success) {
            alert('টাস্ক সম্পন্ন হয়েছে! +' + data.reward + ' ৳ যোগ হয়েছে।');
            syncUserData();
            loadTasks();
          } else { 
            alert(data.error); 
          }
        })
        .catch(function() { alert('সার্ভার সমস্যা'); });
      }, 4000);
    }

    function submitWithdraw() {
      var method = document.getElementById('method').value;
      var phone = document.getElementById('phone').value.trim();
      var amount = parseFloat(document.getElementById('amount').value);

      if (!phone || isNaN(amount)) return alert('সঠিক তথ্য লিখুন।');
      if (amount < 10) return alert('সর্বনিম্ন উত্তোলন ১০ টাকা।');

      fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ method, phone, amount })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success) {
          alert('উত্তোলন অনুরোধ সফল হয়েছে!');
          syncUserData();
          document.getElementById('phone').value = '';
          document.getElementById('amount').value = '';
        } else { 
          alert(data.error || 'ব্যর্থ হয়েছে'); 
        }
      })
      .catch(function() { alert('সার্ভার সমস্যা'); });
    }

    function copyLink() {
      var copyText = document.getElementById('refLink');
      if (copyText) {
        copyText.select();
        copyText.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(copyText.value);
        alert('রেফার লিংক কপি হয়েছে!');
      }
    }

    syncUserData();
    loadTasks();
  </script>
</body>
</html>`);
});

// ====================================================================
// ২. ব্যাকএন্ড API রাউটসমূহ
// ====================================================================

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

app.post('/api/daily-bonus', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const today = getTodayDate();
  const BONUS = 0.50;

  db.get('SELECT last_checkin_date FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User Error' });
    if (user.last_checkin_date === today) {
      return res.status(400).json({ error: 'আজকের বোনাস আপনি ইতিমধ্যে নিয়ে নিয়েছেন!' });
    }

    db.run(
      'UPDATE users SET points = points + ?, last_checkin_date = ? WHERE telegram_id = ?',
      [BONUS, today, userId],
      (upErr) => {
        if (upErr) return res.status(500).json({ error: 'Bonus Error' });
        res.json({ success: true, reward: BONUS });
      }
    );
  });
});

app.post('/api/reward', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const today = getTodayDate();
  const REWARD_AMOUNT = 0.075; // প্রতি অ্যাডে ইউজার পাবে ০.০৭৫ ৳ (আপনার লাভ থাকবে)
  const DAILY_LIMIT = 200;

  db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User Error' });

    let currentAds = user.last_ad_date === today ? user.ads_today : 0;
    if (currentAds >= DAILY_LIMIT) {
      return res.status(400).json({ error: 'আজকের ২০০টি অ্যাডের লিমিট শেষ! কাল আবার চেষ্টা করুন।' });
    }

    const updatedAds = currentAds + 1;
    db.run(
      'UPDATE users SET points = points + ?, ads_today = ?, last_ad_date = ?, total_ads = total_ads + 1 WHERE telegram_id = ?',
      [REWARD_AMOUNT, updatedAds, today, userId],
      (updateErr) => {
        if (updateErr) return res.status(500).json({ error: 'Reward Error' });

        // রেফার বোনাস: বন্ধু ৪০টি অ্যাড দেখলে রেফারকারী পাবে ১ টাকা
        if (user.total_ads + 1 === 40 && user.referred_by && user.referral_rewarded === 0) {
          db.run('UPDATE users SET points = points + 1.00 WHERE telegram_id = ?', [user.referred_by]);
          db.run('UPDATE users SET referral_rewarded = 1 WHERE telegram_id = ?', [userId]);
        }

        res.json({ success: true, reward: REWARD_AMOUNT, ads_today: updatedAds });
      }
    );
  });
});

app.get('/api/tasks', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  db.all('SELECT task_id FROM completed_tasks WHERE telegram_id = ?', [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Task Error' });
    const completedIds = rows.map((r) => r.task_id);
    const taskList = TASKS.map((t) => ({ ...t, completed: completedIds.includes(t.id) }));
    res.json(taskList);
  });
});

app.post('/api/claim-task', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const { task_id } = req.body;
  const task = TASKS.find((t) => t.id === task_id);

  if (!task) return res.status(400).json({ error: 'ভুল টাস্ক নির্বাচন' });

  db.run('INSERT INTO completed_tasks (telegram_id, task_id) VALUES (?, ?)', [userId, task_id], function (err) {
    if (err) return res.status(400).json({ error: 'আপনি ইতিমধ্যে এই টাস্কটি সম্পন্ন করেছেন!' });

    db.run('UPDATE users SET points = points + ? WHERE telegram_id = ?', [task.reward, userId], (upErr) => {
      if (upErr) return res.status(500).json({ error: 'Task Reward Error' });
      res.json({ success: true, reward: task.reward });
    });
  });
});

app.post('/api/withdraw', verifyTelegramData, (req, res) => {
  const userId = req.user.id.toString();
  const { method, phone, amount } = req.body;

  if (!['bkash', 'nagad', 'upay'].includes(method)) {
    return res.status(400).json({ error: 'ভুল পেমেন্ট মেথড' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 10) {
    return res.status(400).json({ error: 'সর্বনিম্ন উত্তোলন ১০ টাকা' });
  }

  db.get('SELECT points FROM users WHERE telegram_id = ?', [userId], (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'User Error' });
    if (user.points < numericAmount) {
      return res.status(400).json({ error: 'পর্যাপ্ত ব্যালেন্স নেই' });
    }

    db.run('UPDATE users SET points = points - ? WHERE telegram_id = ?', [numericAmount, userId], (deductErr) => {
      if (deductErr) return res.status(500).json({ error: 'Deduct Error' });

      db.run(
        'INSERT INTO withdrawals (telegram_id, method, phone, amount_bdt) VALUES (?, ?, ?, ?)',
        [userId, method, phone, numericAmount],
        (insertErr) => {
          if (insertErr) return res.status(500).json({ error: 'Queue Error' });
          res.json({ success: true, message: 'উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে!' });
        }
      );
    });
  });
});

// ====================================================================
// ৩. অ্যাডমিন কন্ট্রোল এপিআই ও ড্যাশবোর্ড (/admin)
// ====================================================================

app.get('/api/admin/withdrawals', (req, res) => {
  if (req.query.secret !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'ভুল পাসওয়ার্ড!' });
  }
  db.all('SELECT * FROM withdrawals ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB Error' });
    res.json(rows);
  });
});

app.post('/api/admin/update-status', (req, res) => {
  const { secret, id, status } = req.body;
  if (secret !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'ভুল পাসওয়ার্ড!' });
  }
  db.run('UPDATE withdrawals SET status = ? WHERE id = ?', [status, id], function (err) {
    if (err) return res.status(500).json({ error: 'Update Error' });
    res.json({ success: true, message: `উইথড্র #${id} স্ট্যাটাস ${status} করা হয়েছে` });
  });
});

app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>অ্যাডমিন প্যানেল - BD Ad Earn</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0b132b; color: #fff; padding: 16px; margin: 0; }
    h2 { font-size: 18px; color: #48cae4; margin-bottom: 12px; }
    .input-box { display: flex; gap: 8px; margin-bottom: 16px; }
    input { flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #334155; background: #1c2541; color: #fff; }
    button { padding: 10px 16px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
    .btn-load { background: #38bdf8; color: #000; }
    .item { background: #1c2541; border: 1px solid #334155; padding: 12px; border-radius: 8px; margin-bottom: 10px; }
    .item p { margin: 4px 0; font-size: 13px; }
    .btn-ok { background: #10b981; color: #fff; width: 100%; margin-top: 8px; padding: 8px; }
    .status-pending { color: #f59e0b; font-weight: bold; }
    .status-successful { color: #10b981; font-weight: bold; }
  </style>
</head>
<body>
  <h2>উইথড্রল অ্যাডমিন কন্ট্রোল</h2>
  <div class="input-box">
    <input type="password" id="pass" placeholder="অ্যাডমিন পাসওয়ার্ড লিখুন" value="adminpass123">
    <button class="btn-load" onclick="loadWithdrawals()">লোড</button>
  </div>
  <div id="list">লোড বাটনে চাপ দিন...</div>

  <script>
    function loadWithdrawals() {
      var pass = document.getElementById('pass').value;
      fetch('/api/admin/withdrawals?secret=' + encodeURIComponent(pass))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if(data.error) return alert(data.error);
          var container = document.getElementById('list');
          if(data.length === 0) {
            container.innerHTML = 'কোনো উইথড্র রিকোয়েস্ট নেই।';
            return;
          }
          container.innerHTML = '';
          data.forEach(function(item) {
            var btnHtml = item.status === 'pending'
              ? '<button class="btn-ok" onclick="markSuccessful(' + item.id + ')">পেমেন্ট কমপ্লিট করুন</button>'
              : '';
            container.innerHTML += '<div class="item">' +
              '<p><b>আইডি:</b> #' + item.id + ' | <b>ইউজার:</b> ' + item.telegram_id + '</p>' +
              '<p><b>মেথড:</b> ' + item.method.toUpperCase() + ' | <b>নম্বর:</b> ' + item.phone + '</p>' +
              '<p><b>টাকা:</b> ' + item.amount_bdt + ' ৳ | <b>স্ট্যাটাস:</b> <span class="status-' + item.status + '">' + item.status + '</span></p>' +
              btnHtml + '</div>';
          });
        });
    }

    function markSuccessful(id) {
      var pass = document.getElementById('pass').value;
      fetch('/api/admin/update-status', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ secret: pass, id: id, status: 'successful' })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if(data.success) {
          alert('স্ট্যাটাস সফল করা হয়েছে!');
          loadWithdrawals();
        } else {
          alert(data.error);
        }
      });
    }
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
