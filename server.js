const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_PASSWORD = "adminpass123";
const MONGO_URI = process.env.MONGO_URI || "আপনার_MONGODB_URI";

// ==========================================
// MongoDB কানেকশন ও স্কিমা
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

const UserSchema = new mongoose.Schema({
  telegram_id: { type: String, required: true, unique: true },
  username: { type: String, default: 'User' },
  country_mode: { type: String, default: 'BD' }, // 'BD' or 'GLOBAL'
  points_bdt: { type: Number, default: 0 },
  points_usdt: { type: Number, default: 0 },
  last_checkin_date: { type: String, default: '' },
  total_ads: { type: Number, default: 0 },
  referred_by: { type: String, default: null },
  referral_rewarded: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

const TaskSchema = new mongoose.Schema({
  telegram_id: { type: String, required: true },
  task_id: { type: String, required: true }
});
TaskSchema.index({ telegram_id: 1, task_id: 1 }, { unique: true });

const WithdrawalSchema = new mongoose.Schema({
  telegram_id: { type: String, required: true },
  mode: { type: String, required: true }, // 'BD' or 'GLOBAL'
  method: { type: String, required: true }, // bkash, nagad, upay, or usdt
  network: { type: String, default: '' }, // TRC20, TON, BEP20, POLYGON
  destination: { type: String, required: true }, // phone number or wallet address
  amount: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  tx_note: { type: String, default: '' },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const CompletedTask = mongoose.model('CompletedTask', TaskSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

function getSafeUser(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || '';
  if (initData) {
    try {
      const urlParams = new URLSearchParams(initData);
      const userStr = urlParams.get('user');
      if (userStr) {
        req.user = JSON.parse(userStr);
        req.startParam = urlParams.get('start_param') || null;
        return next();
      }
    } catch (e) {}
  }
  req.user = { id: '562005', first_name: 'User', username: 'User', language_code: 'bn' };
  req.startParam = null;
  next();
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

const TASKS = [
  { id: 'task_channel_1', title_bn: 'অফিশিয়াল চ্যানেলে যুক্ত হন', title_en: 'Join Official Channel', link: 'https://t.me/CryptoDropToday', reward_bdt: 1.00, reward_usdt: 0.008 },
  { id: 'task_channel_2', title_bn: 'পার্টনার টেলিগ্রাম গ্রুপ', title_en: 'Join Partner Group', link: 'https://t.me/telegram', reward_bdt: 0.50, reward_usdt: 0.004 }
];

// ==========================================
// ১. ফ্রন্টএন্ড UI
// ==========================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>BD Ad Earn / Global Earn</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://sad.adsgram.ai/js/sad.min.js" async></script>
  <style>
    :root {
      --bg-primary: #0a0f1d;
      --card-bg: #131c31;
      --card-border: #1e2942;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-main);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .top-bar { display: flex; justify-content: space-between; align-items: center; }
    .mode-switch { background: #1e293b; border: 1px solid #334155; color: #38bdf8; border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 16px; }
    .balance-card { text-align: center; }
    .balance-val { font-size: 34px; font-weight: 800; color: #38bdf8; margin: 4px 0 8px; }
    button { width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; margin-top: 8px; }
    .btn-bonus { background: #10b981; color: #fff; }
    .btn-ad { background: linear-gradient(135deg, #0284c7, #00d2ff); color: #fff; }
    .btn-withdraw { background: #10b981; color: #fff; margin-top: 10px; }
    .btn-share { background: #3b82f6; color: #fff; }
    input, select { width: 100%; padding: 10px; margin-top: 6px; border-radius: 6px; border: 1px solid var(--card-border); background: #0d1527; color: #fff; font-size: 13px; }
    .hint-text { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
    .task-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; }
  </style>
</head>
<body>

  <div class="top-bar">
    <div style="font-weight: 700; font-size: 16px;" id="appTitle">🇧🇩 BD Ad Earn</div>
    <button class="mode-switch" onclick="toggleMode()" id="modeBtn">Switch: Global (USDT)</button>
  </div>

  <div class="card balance-card">
    <div style="font-size: 12px; color: var(--text-muted);" id="balLabel">Available Balance</div>
    <div class="balance-val" id="balanceText">0.00</div>
    <div style="font-size: 12px; color: var(--text-muted);">Watched Ads: <b id="totalAds">0</b> (Unlimited)</div>
    <button class="btn-bonus" id="checkinBtn" onclick="claimDailyBonus()">🎁 Claim Daily Bonus</button>
    <button class="btn-ad" id="adBtn" onclick="triggerAd()">📺 Watch Video Ad</button>
  </div>

  <div class="card">
    <div style="font-weight: 700; margin-bottom: 8px;">📋 Tasks</div>
    <div id="taskList">Loading...</div>
  </div>

  <div class="card">
    <div style="font-weight: 700; margin-bottom: 4px;" id="refTitle">👥 Referral Program</div>
    <p class="hint-text" id="refDesc">Invite friends and earn rewards after they watch 40 ads.</p>
    <input type="text" id="refLink" readonly />
    <button class="btn-share" onclick="shareRef()">🚀 Forward / Share</button>
  </div>

  <div class="card">
    <div style="font-weight: 700; margin-bottom: 8px;" id="cashoutTitle">💳 Payout / Withdrawal</div>
    
    <!-- BD Payout -->
    <div id="bdPayoutBox">
      <select id="bdMethod">
        <option value="bkash">bKash (Personal)</option>
        <option value="nagad">Nagad (Personal)</option>
        <option value="upay">Upay (Personal)</option>
      </select>
      <input type="tel" id="bdPhone" placeholder="Mobile Number (01xxxxxxxxx)" />
      <input type="number" id="bdAmount" placeholder="Minimum 5 BDT" />
    </div>

    <!-- Global Payout -->
    <div id="globalPayoutBox" style="display: none;">
      <select id="usdtNetwork">
        <option value="TON">USDT (TON Network / Telegram Wallet)</option>
        <option value="TRC20">USDT (TRC20 - Tron)</option>
        <option value="BEP20">USDT (BEP20 - BNB Chain)</option>
        <option value="POLYGON">USDT (Polygon)</option>
      </select>
      <input type="text" id="walletAddress" placeholder="Enter USDT Wallet Address" />
      <input type="number" step="0.001" id="usdtAmount" placeholder="Minimum 0.10 USDT" />
    </div>

    <button class="btn-withdraw" onclick="requestPayout()">Submit Request</button>
  </div>

  <script>
    var currentMode = 'BD'; // BD or GLOBAL
    var ADSGRAM_BLOCK_ID = '46321';
    var BOT_USERNAME = 'BDAdEarnBot';

    var tg = window.Telegram ? window.Telegram.WebApp : null;
    if (tg) { try { tg.expand(); tg.ready(); } catch(e) {} }

    var initData = (tg && tg.initData) ? tg.initData : '';
    var userId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.id : '562005';
    var userLang = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) ? tg.initDataUnsafe.user.language_code : 'bn';

    currentMode = (userLang === 'bn') ? 'BD' : 'GLOBAL';

    var fullRefLink = 'https://t.me/' + BOT_USERNAME + '/app?startapp=' + userId;
    document.getElementById('refLink').value = fullRefLink;

    function applyUIMode() {
      if (currentMode === 'BD') {
        document.getElementById('appTitle').innerText = '🇧🇩 BD Ad Earn';
        document.getElementById('modeBtn').innerText = 'Switch: Global (USDT)';
        document.getElementById('bdPayoutBox').style.display = 'block';
        document.getElementById('globalPayoutBox').style.display = 'none';
        document.getElementById('cashoutTitle').innerText = '💳 টাকা উত্তোলন (মিনিমাম ৫ ৳)';
      } else {
        document.getElementById('appTitle').innerText = '🌐 Global Ad Earn';
        document.getElementById('modeBtn').innerText = 'Switch: Bangladesh (BDT)';
        document.getElementById('bdPayoutBox').style.display = 'none';
        document.getElementById('globalPayoutBox').style.display = 'block';
        document.getElementById('cashoutTitle').innerText = '💳 USDT Withdrawal (Min: $0.10)';
      }
      syncUser();
    }

    function toggleMode() {
      currentMode = (currentMode === 'BD') ? 'GLOBAL' : 'BD';
      applyUIMode();
    }

    function shareRef() {
      var txt = currentMode === 'BD' 
        ? 'ভিডিও অ্যাড দেখে প্রতিদিন ইনকাম করুন! ইনস্ট্যান্ট পেমেন্ট: ' + fullRefLink
        : 'Watch video ads and earn free USDT! Start here: ' + fullRefLink;
      var shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(fullRefLink) + '&text=' + encodeURIComponent(txt);
      if (tg && tg.openTelegramLink) tg.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
    }

    function syncUser() {
      fetch('/api/user?mode=' + currentMode, { headers: { 'x-telegram-init-data': initData } })
        .then(res => res.json())
        .then(data => {
          if (currentMode === 'BD') {
            document.getElementById('balanceText').innerText = (data.points_bdt || 0).toFixed(2) + ' ৳';
          } else {
            document.getElementById('balanceText').innerText = (data.points_usdt || 0).toFixed(4) + ' USDT';
          }
          document.getElementById('totalAds').innerText = data.total_ads || 0;
        });
      loadTasks();
    }

    function triggerAd() {
      var adBtn = document.getElementById('adBtn');
      if (window.Adsgram) {
        try {
          var AdController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
          AdController.show()
            .then(() => claimReward(adBtn))
            .catch(() => claimReward(adBtn));
          return;
        } catch(e) {}
      }
      claimReward(adBtn);
    }

    function claimReward(btn) {
      btn.disabled = true;
      fetch('/api/reward?mode=' + currentMode, { method: 'POST', headers: { 'x-telegram-init-data': initData } })
        .then(res => res.json())
        .then(data => {
          btn.disabled = false;
          syncUser();
        })
        .catch(() => { btn.disabled = false; });
    }

    function claimDailyBonus() {
      fetch('/api/daily-bonus?mode=' + currentMode, { method: 'POST', headers: { 'x-telegram-init-data': initData } })
        .then(res => res.json())
        .then(data => {
          if (data.success) { alert('Bonus added!'); syncUser(); }
          else alert(data.error);
        });
    }

    function loadTasks() {
      fetch('/api/tasks?mode=' + currentMode, { headers: { 'x-telegram-init-data': initData } })
        .then(res => res.json())
        .then(tasks => {
          var container = document.getElementById('taskList');
          container.innerHTML = '';
          tasks.forEach(t => {
            var title = currentMode === 'BD' ? t.title_bn : t.title_en;
            var reward = currentMode === 'BD' ? t.reward_bdt.toFixed(2) + ' ৳' : t.reward_usdt.toFixed(4) + ' USDT';
            var right = t.completed ? '<span style="color:#10b981;">✓ Done</span>' : '<button style="width:auto;padding:4px 8px;font-size:11px;" onclick="doTask(\\'' + t.id + '\\', \\'' + t.link + '\\')">Start</button>';
            container.innerHTML += '<div class="task-item"><div><b>' + title + '</b><br><small style="color:#38bdf8;">+' + reward + '</small></div><div>' + right + '</div></div>';
          });
        });
    }

    function doTask(id, link) {
      if (tg && tg.openLink) tg.openLink(link);
      else window.open(link, '_blank');
      setTimeout(() => {
        fetch('/api/claim-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ task_id: id, mode: currentMode })
        }).then(r => r.json()).then(d => {
          if (d.success) syncUser();
          else alert(d.error);
        });
      }, 4000);
    }

    function requestPayout() {
      var payload = { mode: currentMode };
      if (currentMode === 'BD') {
        payload.method = document.getElementById('bdMethod').value;
        payload.destination = document.getElementById('bdPhone').value.trim();
        payload.amount = parseFloat(document.getElementById('bdAmount').value);
      } else {
        payload.method = 'USDT';
        payload.network = document.getElementById('usdtNetwork').value;
        payload.destination = document.getElementById('walletAddress').value.trim();
        payload.amount = parseFloat(document.getElementById('usdtAmount').value);
      }

      fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('Withdrawal request submitted!');
          syncUser();
        } else {
          alert(data.error);
        }
      });
    }

    applyUIMode();
  </script>
</body>
</html>`);
});

// ==========================================
// ২. অ্যাডমিন প্যানেল
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"><title>Admin Dashboard</title>
  <style>
    body { font-family: sans-serif; background: #0b1120; color: #fff; padding: 20px; }
    .card { background: #1e293b; padding: 12px; margin-bottom: 10px; border-radius: 8px; }
    button { padding: 8px 14px; border: none; border-radius: 6px; cursor: pointer; }
    .btn-paid { background: #10b981; color: #fff; margin-top: 6px; }
    input { padding: 8px; border-radius: 4px; border: 1px solid #334155; background: #0f172a; color: #fff; }
  </style>
</head>
<body>
  <h2>Admin Payout Manager</h2>
  <input type="password" id="pass" value="adminpass123" />
  <button onclick="load()" style="background:#38bdf8;color:#000;">Load</button>
  <div id="list" style="margin-top:20px;"></div>
  <script>
    function load() {
      fetch('/api/admin/withdrawals?secret=' + document.getElementById('pass').value)
        .then(r => r.json())
        .then(data => {
          var c = document.getElementById('list');
          c.innerHTML = '';
          data.forEach(item => {
            var dest = item.mode === 'BD' ? (item.method + ' - ' + item.destination) : (item.method + ' (' + item.network + ') - ' + item.destination);
            var action = item.status === 'pending'
              ? '<input id="note-' + item._id + '" placeholder="TxID / Note" /><br><button class="btn-paid" onclick="mark(\\'' + item._id + '\\')">Mark as Paid</button>'
              : '<span style="color:#10b981;">Paid (' + (item.tx_note || 'Done') + ')</span>';
            c.innerHTML += '<div class="card"><p><b>User:</b> ' + item.telegram_id + ' | <b>Amount:</b> ' + item.amount + (item.mode === 'BD' ? ' BDT' : ' USDT') + '</p><p><b>Destination:</b> ' + dest + '</p><p><b>Status:</b> ' + item.status + '</p>' + action + '</div>';
          });
        });
    }
    function mark(id) {
      var note = document.getElementById('note-' + id).value;
      fetch('/api/admin/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: document.getElementById('pass').value, id: id, status: 'successful', tx_note: note })
      }).then(r => r.json()).then(d => { if(d.success) load(); });
    }
    load();
  </script>
</body>
</html>`);
});

// ==========================================
// ৩. ব্যাকএন্ড API রাউট
// ==========================================
app.get('/api/user', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  try {
    let user = await User.findOne({ telegram_id: userId });
    if (!user) {
      user = await User.create({ telegram_id: userId, referred_by: req.startParam });
    }
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/daily-bonus', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const mode = req.query.mode || 'BD';
  const today = getTodayDate();

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user) return res.status(404).json({ error: 'User Error' });
    if (user.last_checkin_date === today) return res.status(400).json({ error: 'Already claimed today!' });

    if (mode === 'BD') user.points_bdt += 0.50;
    else user.points_usdt += 0.005;

    user.last_checkin_date = today;
    await user.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/reward', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const mode = req.query.mode || 'BD';

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user) return res.status(404).json({ error: 'User Error' });

    if (mode === 'BD') user.points_bdt += 0.075;
    else user.points_usdt += 0.001; // Tier 1/Global users get $0.001 USDT

    user.total_ads += 1;

    // Referral reward after 40 ads
    if (user.total_ads === 40 && user.referred_by && !user.referral_rewarded) {
      await User.updateOne({ telegram_id: user.referred_by }, { $inc: { points_bdt: 1.00, points_usdt: 0.008 } });
      user.referral_rewarded = true;
    }

    await user.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.get('/api/tasks', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  try {
    const completed = await CompletedTask.find({ telegram_id: userId });
    const compIds = completed.map(c => c.task_id);
    const list = TASKS.map(t => ({ ...t, completed: compIds.includes(t.id) }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/claim-task', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const { task_id, mode } = req.body;
  const task = TASKS.find(t => t.id === task_id);
  if (!task) return res.status(400).json({ error: 'Invalid task' });

  try {
    const done = await CompletedTask.findOne({ telegram_id: userId, task_id });
    if (done) return res.status(400).json({ error: 'Already completed' });

    await CompletedTask.create({ telegram_id: userId, task_id });
    const incObj = (mode === 'BD') ? { points_bdt: task.reward_bdt } : { points_usdt: task.reward_usdt };
    await User.updateOne({ telegram_id: userId }, { $inc: incObj });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/withdraw', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const { mode, method, network, destination, amount } = req.body;

  if (!destination || isNaN(amount)) return res.status(400).json({ error: 'Invalid details' });

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user) return res.status(404).json({ error: 'User Error' });

    if (mode === 'BD') {
      if (amount < 5) return res.status(400).json({ error: 'মিনিমাম ৫ টাকা উত্তোলন প্রয়োজন।' });
      if (user.points_bdt < amount) return res.status(400).json({ error: 'পর্যাপ্ত BDT ব্যালেন্স নেই।' });
      user.points_bdt -= amount;
    } else {
      if (amount < 0.10) return res.status(400).json({ error: 'Minimum withdrawal is 0.10 USDT.' });
      if (user.points_usdt < amount) return res.status(400).json({ error: 'Insufficient USDT balance.' });
      user.points_usdt -= amount;
    }

    await user.save();
    await Withdrawal.create({
      telegram_id: userId,
      mode,
      method,
      network: network || '',
      destination,
      amount
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Withdrawal Error' });
  }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  if (req.query.secret !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Unauthorized' });
  const rows = await Withdrawal.find().sort({ created_at: -1 });
  res.json(rows);
});

app.post('/api/admin/update-status', async (req, res) => {
  const { secret, id, status, tx_note } = req.body;
  if (secret !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Unauthorized' });
  await Withdrawal.findByIdAndUpdate(id, { status, tx_note });
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
