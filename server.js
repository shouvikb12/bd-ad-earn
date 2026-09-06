const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ADMIN_PASSWORD = "adminpass123";
const MONGO_URI = process.env.MONGO_URI || "আপনার_MONGODB_ATLAS_URI_এখানে_দিন";

// ==========================================
// MongoDB কানেকশন ও স্কিমা
// ==========================================
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const UserSchema = new mongoose.Schema({
  telegram_id: { type: String, required: true, unique: true },
  username: { type: String, default: 'User' },
  points: { type: Number, default: 0 },
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
  method: { type: String, required: true },
  phone: { type: String, required: true },
  amount_bdt: { type: Number, required: true },
  status: { type: String, default: 'pending' }, // pending, successful
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
  
  req.user = { id: '562005', first_name: 'User', username: 'User' };
  req.startParam = null;
  next();
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

const TASKS = [
  { id: 'task_channel_1', title: 'আমাদের অফিশিয়াল চ্যানেলে জয়েন করুন', link: 'https://t.me/CryptoDropToday', reward: 1.00 },
  { id: 'task_channel_2', title: 'পার্টনার টেলিগ্রাম গ্রুপে জয়েন করুন', link: 'https://t.me/telegram', reward: 0.50 },
  { id: 'task_youtube_1', title: 'ইউটিউব চ্যানেল সাবস্ক্রাইব করুন', link: 'https://youtube.com/@gaming_craze04', reward: 0.50 }
];

// ==========================================
// ১. ফ্রন্টএন্ড UI (মিনি অ্যাপ)
// ==========================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>BD Ad Earn</title>
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
    .ad-stat { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
    
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
    .btn-share { background: #3b82f6; color: #fff; margin-top: 8px; }
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
    .btn-group { display: flex; gap: 8px; }
  </style>
</head>
<body>

  <div class="top-header">
    <div class="brand-title">&#127463;&#127465; BD Ad Earn</div>
    <div class="badge-live">&#9679; অনলাইন</div>
  </div>

  <div class="card balance-card">
    <div class="balance-title">মোট ব্যালেন্স</div>
    <div class="balance-value"><span id="balance">0.00</span> &#2547;</div>
    <div class="ad-stat">মোট দেখা অ্যাড: <b id="totalAds">0</b> টি (আনলিমিটেড)</div>

    <button class="btn-bonus" id="checkinBtn" onclick="claimDailyBonus()">&#127873; ডেইলি বোনাস নিন (+০.৫০ &#2547;)</button>
    <button class="btn-ad" id="adBtn" onclick="triggerAd()">&#128250; ভিডিও অ্যাড দেখুন (+০.০৭৫ &#2547;)</button>
  </div>

  <div class="card">
    <div class="card-heading">&#128203; সোশ্যাল টাস্ক</div>
    <div id="taskList"><div style="font-size: 12px; color: var(--text-muted);">টাস্ক লোড হচ্ছে...</div></div>
  </div>

  <div class="card">
    <div class="card-heading" style="color: #f59e0b;">&#128101; রেফার বোনাস (১.০০ &#2547;)</div>
    <p class="hint-text">বন্ধু রেফার লিংকে যুক্ত হয়ে <b>৪০টি অ্যাড</b> দেখলে আপনার ব্যালেন্সে ১ টাকা সরাসরি যোগ হবে।</p>
    <input type="text" id="refLink" readonly />
    <div class="btn-group">
      <button class="btn-share" onclick="shareTelegram()">🚀 ফরোয়ার্ড / শেয়ার</button>
      <button class="btn-copy" onclick="copyLink()">📋 কপি</button>
    </div>
  </div>

  <div class="card">
    <div class="card-heading" style="color: #00d2ff;">&#128179; টাকা উত্তোলন (মিনিমাম ৫ &#2547;)</div>
    <select id="method">
      <option value="bkash">বিকাশ (Personal)</option>
      <option value="nagad">নগদ (Personal)</option>
      <option value="upay">উপায় (Personal)</option>
    </select>
    <input type="tel" id="phone" placeholder="মোবাইল নম্বর লিখুন (০১xxxxxxxxx)" />
    <input type="number" id="amount" placeholder="পরিমাণ লিখুন (মিনিমাম ৫ &#2547;)" />
    <button class="btn-withdraw" onclick="submitWithdraw()">উত্তোলন অনুরোধ পাঠান</button>
    <p class="hint-text">অনুরোধ যাচাই করে ২৪-৪৮ ঘণ্টার মধ্যে পেমেন্ট সম্পন্ন করা হয়।</p>
  </div>

  <script>
    var BOT_USERNAME = 'BDAdEarnBot'; 
    var ADSGRAM_BLOCK_ID = '46321'; 

    var tg = window.Telegram ? window.Telegram.WebApp : null;
    if (tg) { 
      try { tg.expand(); tg.ready(); } catch(e) {}
    }

    var initData = (tg && tg.initData) ? tg.initData : '';
    var userId = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) ? tg.initDataUnsafe.user.id : '562005';
    var fullRefLink = 'https://t.me/' + BOT_USERNAME + '/app?startapp=' + userId;

    var refInput = document.getElementById('refLink');
    if (refInput) {
      refInput.value = fullRefLink;
    }

    function shareTelegram() {
      var shareText = encodeURIComponent('🔥 ঘরে বসে ভিডিও অ্যাড দেখে ও সহজ কাজ করে টাকা আয় করুন! প্রতি রেফারে নিশ্চিত বোনাস। এখনই জয়েন করুন: ' + fullRefLink);
      var shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(fullRefLink) + '&text=' + shareText;
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
    }

    function syncUserData() {
      fetch('/api/user', { headers: { 'x-telegram-init-data': initData } })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.points !== undefined) {
            document.getElementById('balance').innerText = parseFloat(data.points).toFixed(2);
            document.getElementById('totalAds').innerText = data.total_ads || 0;

            if (!data.can_checkin) {
              var btn = document.getElementById('checkinBtn');
              btn.innerText = '✅ আজকের বোনাস নেওয়া শেষ';
              btn.disabled = true;
            }
          }
        })
        .catch(function(err) { console.error(err); });
    }

    function triggerAd() {
      var adBtn = document.getElementById('adBtn');

      if (window.Adsgram) {
        try {
          var AdController = window.Adsgram.init({ blockId: ADSGRAM_BLOCK_ID });
          AdController.show()
            .then(function() {
              claimReward();
              startAdCooldown(adBtn);
            })
            .catch(function(err) {
              claimReward();
              startAdCooldown(adBtn);
            });
          return;
        } catch(e) {}
      }

      claimReward();
      startAdCooldown(adBtn);
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
      if (amount < 5) return alert('সর্বনিম্ন উত্তোলন ৫ টাকা।');

      fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ method: method, phone: phone, amount: amount })
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

// ==========================================
// ২. অ্যাডমিন ড্যাশবোর্ড (/admin)
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>অ্যাডমিন প্যানেল - BD Ad Earn</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #080d1a; color: #fff; padding: 16px; margin: 0; }
    h2 { font-size: 20px; color: #38bdf8; margin-bottom: 12px; }
    .input-box { display: flex; gap: 8px; margin-bottom: 12px; }
    input, select { padding: 10px; border-radius: 8px; border: 1px solid #1e293b; background: #0f172a; color: #fff; font-size: 13px; }
    button { padding: 10px 16px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
    .btn-load { background: #38bdf8; color: #000; }
    .filters { display: flex; gap: 8px; margin-bottom: 16px; }
    .btn-filter { background: #1e293b; color: #94a3b8; padding: 6px 14px; font-size: 12px; }
    .btn-filter.active { background: #0284c7; color: #fff; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .card p { margin: 4px 0; font-size: 13px; }
    .status-pending { color: #f59e0b; font-weight: bold; }
    .status-successful { color: #10b981; font-weight: bold; }
    .btn-action { background: #10b981; color: #fff; width: 100%; margin-top: 8px; padding: 8px; border-radius: 6px; font-weight: bold; border: none; cursor: pointer; }
    .note-input { width: 100%; box-sizing: border-box; margin-top: 6px; }
  </style>
</head>
<body>
  <h2>🔐 উইথড্রল অ্যাডমিন কন্ট্রোল</h2>
  <div class="input-box">
    <input type="password" id="pass" placeholder="অ্যাডমিন পাসওয়ার্ড" value="adminpass123" style="flex:1;">
    <button class="btn-load" onclick="loadWithdrawals()">ডাটা লোড</button>
  </div>

  <div class="filters">
    <button class="btn-filter active" id="f-all" onclick="setFilter('all')">সবগুলো</button>
    <button class="btn-filter" id="f-pending" onclick="setFilter('pending')">বাকি আছে (Pending)</button>
    <button class="btn-filter" id="f-successful" onclick="setFilter('successful')">দেওয়া হয়েছে (Paid)</button>
  </div>

  <div id="list">ডাটা লোড হচ্ছে...</div>

  <script>
    var currentFilter = 'all';
    var allData = [];

    function setFilter(f) {
      currentFilter = f;
      document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
      document.getElementById('f-' + f).classList.add('active');
      renderList();
    }

    function loadWithdrawals() {
      var pass = document.getElementById('pass').value;
      fetch('/api/admin/withdrawals?secret=' + encodeURIComponent(pass))
        .then(res => res.json())
        .then(data => {
          if (data.error) return alert(data.error);
          allData = data;
          renderList();
        })
        .catch(() => alert('ডাটা লোড ব্যর্থ'));
    }

    function renderList() {
      var container = document.getElementById('list');
      var list = allData.filter(item => currentFilter === 'all' ? true : item.status === currentFilter);

      if (list.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8;">কোনো রেকর্ড পাওয়া যায়নি।</p>';
        return;
      }

      container.innerHTML = '';
      list.forEach(item => {
        var actionHtml = item.status === 'pending'
          ? '<input type="text" id="note-' + item._id + '" class="note-input" placeholder="TrxID বা নোট (ঐচ্ছিক)" />' +
            '<button class="btn-action" onclick="markDone(\\'' + item._id + '\\')">পেমেন্ট সম্পন্ন করুন (Mark Paid)</button>'
          : '<p style="color:#10b981;font-size:12px;margin-top:6px;">✓ পেমেন্ট ক্লিয়ার্ড ' + (item.tx_note ? '(' + item.tx_note + ')' : '') + '</p>';

        container.innerHTML += '<div class="card">' +
          '<p><b>আইডি:</b> #' + item._id.substring(item._id.length - 6) + ' | <b>ইউজার:</b> ' + item.telegram_id + '</p>' +
          '<p><b>মেথড:</b> ' + item.method.toUpperCase() + ' | <b>নম্বর:</b> ' + item.phone + '</p>' +
          '<p><b>পরিমাণ:</b> ' + item.amount_bdt + ' ৳ | <b>স্ট্যাটাস:</b> <span class="status-' + item.status + '">' + item.status + '</span></p>' +
          actionHtml +
          '</div>';
      });
    }

    function markDone(id) {
      var pass = document.getElementById('pass').value;
      var note = document.getElementById('note-' + id) ? document.getElementById('note-' + id).value : '';

      fetch('/api/admin/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: pass, id: id, status: 'successful', tx_note: note })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('পেমেন্ট সফল হিসেবে আপডেট করা হয়েছে!');
          loadWithdrawals();
        } else {
          alert(data.error);
        }
      });
    }

    loadWithdrawals();
  </script>
</body>
</html>`);
});

// ==========================================
// ৩. ব্যাকএন্ড API রাউটসমূহ
// ==========================================
app.get('/api/user', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const username = req.user.username || req.user.first_name || 'User';
  const referrerId = req.startParam && req.startParam !== userId ? req.startParam : null;
  const today = getTodayDate();

  try {
    let user = await User.findOne({ telegram_id: userId });
    if (!user) {
      user = await User.create({
        telegram_id: userId,
        username: username,
        points: 0,
        referred_by: referrerId
      });
    }
    const canCheckin = user.last_checkin_date !== today;
    res.json({
      telegram_id: user.telegram_id,
      points: user.points,
      total_ads: user.total_ads,
      can_checkin: canCheckin
    });
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/daily-bonus', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const today = getTodayDate();
  const BONUS = 0.50;

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user) return res.status(404).json({ error: 'User Error' });
    if (user.last_checkin_date === today) {
      return res.status(400).json({ error: 'আজকের বোনাস নেওয়া শেষ!' });
    }

    user.points += BONUS;
    user.last_checkin_date = today;
    await user.save();

    res.json({ success: true, reward: BONUS });
  } catch (e) {
    res.status(500).json({ error: 'Bonus Error' });
  }
});

app.post('/api/reward', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const REWARD_AMOUNT = 0.075;

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user) return res.status(404).json({ error: 'User Error' });

    user.points += REWARD_AMOUNT;
    user.total_ads += 1;

    // রেফার বোনাস: ইউজার ৪০টি অ্যাড দেখলে রেফারকারী পাবে ১ টাকা
    if (user.total_ads === 40 && user.referred_by && !user.referral_rewarded) {
      await User.updateOne({ telegram_id: user.referred_by }, { $inc: { points: 1.00 } });
      user.referral_rewarded = true;
    }

    await user.save();
    res.json({ success: true, reward: REWARD_AMOUNT, total_ads: user.total_ads });
  } catch (e) {
    res.status(500).json({ error: 'Reward Error' });
  }
});

app.get('/api/tasks', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  try {
    const completed = await CompletedTask.find({ telegram_id: userId });
    const completedIds = completed.map(t => t.task_id);
    const taskList = TASKS.map(t => ({ ...t, completed: completedIds.includes(t.id) }));
    res.json(taskList);
  } catch (e) {
    res.status(500).json({ error: 'Task Error' });
  }
});

app.post('/api/claim-task', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const { task_id } = req.body;
  const task = TASKS.find(t => t.id === task_id);

  if (!task) return res.status(400).json({ error: 'ভুল টাস্ক' });

  try {
    const existing = await CompletedTask.findOne({ telegram_id: userId, task_id });
    if (existing) return res.status(400).json({ error: 'টাস্কটি ইতিমধ্যে সম্পন্ন করেছেন!' });

    await CompletedTask.create({ telegram_id: userId, task_id });
    await User.updateOne({ telegram_id: userId }, { $inc: { points: task.reward } });

    res.json({ success: true, reward: task.reward });
  } catch (e) {
    res.status(500).json({ error: 'Task Reward Error' });
  }
});

app.post('/api/withdraw', getSafeUser, async (req, res) => {
  const userId = req.user.id.toString();
  const { method, phone, amount } = req.body;

  if (!['bkash', 'nagad', 'upay'].includes(method)) {
    return res.status(400).json({ error: 'ভুল পেমেন্ট মেথড' });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount < 5) {
    return res.status(400).json({ error: 'সর্বনিম্ন উত্তোলন ৫ টাকা' });
  }

  try {
    const user = await User.findOne({ telegram_id: userId });
    if (!user || user.points < numericAmount) {
      return res.status(400).json({ error: 'পর্যাপ্ত ব্যালেন্স নেই' });
    }

    user.points -= numericAmount;
    await user.save();

    await Withdrawal.create({
      telegram_id: userId,
      method,
      phone,
      amount_bdt: numericAmount
    });

    res.json({ success: true, message: 'উইথড্র রিকোয়েস্ট সফলভাবে জমা হয়েছে!' });
  } catch (e) {
    res.status(500).json({ error: 'Withdrawal Error' });
  }
});

// অ্যাডমিন কন্ট্রোল এপিআই
app.get('/api/admin/withdrawals', async (req, res) => {
  if (req.query.secret !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'ভুল পাসওয়ার্ড!' });
  }
  try {
    const rows = await Withdrawal.find().sort({ created_at: -1 });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'DB Error' });
  }
});

app.post('/api/admin/update-status', async (req, res) => {
  const { secret, id, status, tx_note } = req.body;
  if (secret !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'ভুল পাসওয়ার্ড!' });
  }
  try {
    await Withdrawal.findByIdAndUpdate(id, { status, tx_note: tx_note || '' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Update Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
