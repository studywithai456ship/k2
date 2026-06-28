const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const path = require('path');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { fork } = require('child_process');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  SUPABASE CLIENT
//  Uses SERVICE_ROLE_KEY if available (bypasses RLS), otherwise
//  falls back to ANON_KEY (RLS policies allow anon CRUD).
// ============================================================

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
  process.exit(1);
}

const usingServiceRole = !!(process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log(`✅ Supabase client initialised (${usingServiceRole ? 'service role' : 'anon key — RLS policies required'})`);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Retry wrapper — handles "schema cache" errors that occur right after
// a migration before PostgREST has refreshed its schema cache.
async function supabaseQuery(operation, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const msg = err.message || String(err);
      if (msg.includes('schema cache') || msg.includes('Could not find the table')) {
        console.warn(`⚠️ Schema cache miss (attempt ${attempt}/${maxRetries}), retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ============================================================
//  HELPERS
// ============================================================

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseAppDate(value) {
  if (value instanceof Date) return value;
  if (!value) return new Date();
  if (typeof value === 'string') {
    const ddmmyyyy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    }
    const yyyymmdd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) {
      return new Date(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3]));
    }
  }
  return new Date(value);
}

function daysBetween(a, b) {
  const d1 = parseAppDate(a); d1.setHours(0, 0, 0, 0);
  const d2 = parseAppDate(b); d2.setHours(0, 0, 0, 0);
  return Math.round((d2 - d1) / 86400000);
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getSettingValue(key, defaultValue) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data) return defaultValue;
  return data.value;
}

async function setSettingValue(key, value) {
  const { error } = await supabase.from('settings').upsert({ key, value: JSON.stringify(value) }, { onConflict: 'key' });
  if (error) console.error('setSettingValue error:', error.message);
}

function getDayPlannedHours(day) {
  if (day.plannedHours !== undefined && day.plannedHours !== null && day.plannedHours !== '') {
    const planned = Number(day.plannedHours);
    if (!Number.isNaN(planned)) return planned;
  }
  return ((Number(day.videos) || 0) * 0.75) + ((Number(day.files) || 0) * 0.5);
}

function getAverageStudyHours(days) {
  const completed = (days || []).filter(d => d.status === 'done');
  if (!completed.length) return 0;
  const totalHours = completed.reduce((sum, day) => {
    const actual = Number(day.actualHours);
    return sum + (actual > 0 ? actual : getDayPlannedHours(day));
  }, 0);
  return totalHours / completed.length;
}

// Default bot settings (used when a user has never saved settings)
function defaultBotSettings() {
  return {
    dailyReminder: false,
    interval: 30,
    morningTime: '05:00',
    eveningTime: '21:00',
    eveningCheckin: false,
    weeklySummary: false,
    countdownAlerts: false,
    missedAlerts: false,
    completionCheck: false,
  };
}

// ============================================================
//  TELEGRAM NOTIFICATION HELPER
// ============================================================

async function sendTelegramMessage(chatId, text) {
  if (!chatId) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
    console.log(`📨 Telegram message sent to ${chatId}`);
  } catch (e) {
    console.error('❌ Failed to send Telegram message:', e.message);
  }
}

// ============================================================
//  MIDDLEWARE
// ============================================================

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function botAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ============================================================
//  API ROUTES
// ============================================================

// ---- Settings ----
app.get('/api/settings', async (req, res) => {
  const freeMode = await getSettingValue('free_mode', true);
  const devMode = await getSettingValue('dev_mode', true);
  res.json({ freeMode, devMode });
});

app.post('/api/admin/free', async (req, res) => {
  const { token, enabled } = req.body;
  if (token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).json({ error: 'Invalid admin token' });
  }
  await setSettingValue('free_mode', enabled);
  res.json({ freeMode: enabled });
});

app.get('/api/admin/toggles', botAuth, async (req, res) => {
  const freeEnabled = await getSettingValue('free_mode', true);
  const devEnabled = await getSettingValue('dev_mode', true);
  res.json({ freeEnabled, devEnabled });
});

app.post('/api/admin/toggle', botAuth, async (req, res) => {
  const { key, value } = req.body;
  const settingMap = {
    freeEnabled: 'free_mode',
    devEnabled: 'dev_mode',
    freeMode: 'free_mode',
    devMode: 'dev_mode'
  };
  const settingKey = settingMap[key];
  if (!settingKey) return res.status(400).json({ error: 'Invalid toggle key' });
  await setSettingValue(settingKey, Boolean(value));
  res.json({
    freeEnabled: await getSettingValue('free_mode', true),
    devEnabled: await getSettingValue('dev_mode', true)
  });
});

// ---- OTP Routes ----
app.post('/api/otp/send', async (req, res) => {
  const { telegramId, action = 'register' } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  if (action === 'register') {
    const { data: existingUser } = await supabase.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
    if (existingUser) {
      return res.status(400).json({ error: 'This Telegram ID is already registered' });
    }
  }

  // Rate limiting: 3 attempts per 10 minutes
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recentOTPs } = await supabase
    .from('otps')
    .select('id, created_at')
    .eq('telegram_id', telegramId)
    .gt('created_at', tenMinAgo);

  if (recentOTPs && recentOTPs.length >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  // Resend cooldown (60 seconds)
  const { data: lastOTP } = await supabase
    .from('otps')
    .select('created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastOTP) {
    const timeSinceLast = (Date.now() - new Date(lastOTP.created_at).getTime()) / 1000;
    if (timeSinceLast < 60) {
      return res.status(429).json({
        error: `Please wait ${Math.ceil(60 - timeSinceLast)} seconds before requesting a new OTP`
      });
    }
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: insertErr } = await supabase.from('otps').insert({
    telegram_id: telegramId,
    otp,
    action,
    expires_at: expiresAt
  });
  if (insertErr) {
    console.error('OTP insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to generate OTP' });
  }

  const message = `🔐 *Your OTP for Quant Tracker*\n\n` +
    `Code: \`${otp}\`\n\n` +
    `This code expires in 10 minutes.\n` +
    `If you didn't request this, please ignore.`;

  await sendTelegramMessage(telegramId, message);

  console.log(`📤 OTP sent to Telegram ID: ${telegramId}`);
  res.json({ success: true, message: 'OTP sent to your Telegram' });
});

app.post('/api/otp/verify', async (req, res) => {
  const { telegramId, otp } = req.body;

  if (!telegramId || !otp) {
    return res.status(400).json({ error: 'Telegram ID and OTP are required' });
  }

  const { data: otpRecord } = await supabase
    .from('otps')
    .select('id, expires_at, action, used')
    .eq('telegram_id', telegramId)
    .eq('otp', otp)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpRecord) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  if (new Date(otpRecord.expires_at) < new Date()) {
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }

  await supabase.from('otps').update({ used: true }).eq('id', otpRecord.id);

  res.json({
    success: true,
    message: 'OTP verified successfully',
    action: otpRecord.action
  });
});

// ---- Auth Routes ----
app.post('/api/auth/register', async (req, res) => {
  const { email, password, username, telegramId } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data: existingEmail } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
  if (existingEmail) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  if (username) {
    const { data: existingUsername } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already registered' });
    }
  }

  if (telegramId) {
    const { data: existingTelegram } = await supabase.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
    if (existingTelegram) {
      return res.status(400).json({ error: 'This Telegram ID is already linked to another account' });
    }

    const { data: verifiedOTP } = await supabase
      .from('otps')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('used', true)
      .eq('action', 'register')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verifiedOTP) {
      return res.status(400).json({ error: 'Telegram ID not verified. Please verify OTP first.' });
    }
  }

  const hashed = await bcrypt.hash(password, 10);

  const { data: user, error: insertErr } = await supabase.from('users').insert({
    email,
    password: hashed,
    username: username || email.split('@')[0],
    telegram_id: telegramId || null,
    is_verified: !!telegramId
  }).select('id, email, username, telegram_id, subscription, is_verified').single();

  if (insertErr) {
    console.error('Registration error:', insertErr.message);
    return res.status(400).json({ error: 'Registration failed. Please try again.' });
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

  res.json({
    token,
    user: {
      email: user.email,
      username: user.username,
      telegramId: user.telegram_id,
      subscription: user.subscription,
      isVerified: user.is_verified
    }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, username, password } = req.body;
  const identifier = email || username;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  let query = supabase.from('users').select('id, email, username, password, telegram_id, subscription, is_verified');
  if (email) query = query.eq('email', email);
  else query = query.eq('username', username);

  const { data: user } = await query.maybeSingle();

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  res.json({
    token,
    user: {
      email: user.email,
      username: user.username,
      telegramId: user.telegram_id,
      subscription: user.subscription,
      isVerified: user.is_verified
    }
  });
});

// ---- Forgot Password ----
app.post('/api/auth/forgot-password', async (req, res) => {
  const { telegramId } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  const { data: user } = await supabase.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
  if (!user) {
    return res.status(404).json({ error: 'No account found with this Telegram ID' });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from('otps').insert({
    telegram_id: telegramId,
    otp,
    action: 'reset',
    expires_at: expiresAt
  });

  const message = `🔐 *Password Reset OTP*\n\n` +
    `Code: \`${otp}\`\n\n` +
    `This code expires in 10 minutes.\n` +
    `Use this to reset your password on the website.`;

  await sendTelegramMessage(telegramId, message);

  res.json({ success: true, message: 'OTP sent to your Telegram' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { telegramId, otp, newPassword } = req.body;

  if (!telegramId || !otp || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const { data: otpRecord } = await supabase
    .from('otps')
    .select('id, expires_at')
    .eq('telegram_id', telegramId)
    .eq('otp', otp)
    .eq('used', false)
    .eq('action', 'reset')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!otpRecord) {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  if (new Date(otpRecord.expires_at) < new Date()) {
    return res.status(400).json({ error: 'OTP has expired' });
  }

  await supabase.from('otps').update({ used: true }).eq('id', otpRecord.id);

  const hashed = await bcrypt.hash(newPassword, 10);
  const { error: updateErr } = await supabase.from('users')
    .update({ password: hashed, updated_at: new Date().toISOString() })
    .eq('telegram_id', telegramId);

  if (updateErr) {
    return res.status(500).json({ error: 'Failed to reset password' });
  }

  res.json({ success: true, message: 'Password reset successfully' });
});

// ---- Sync ----
app.get('/api/sync', authenticate, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    email: user.email,
    username: user.username,
    telegramId: user.telegram_id,
    isVerified: user.is_verified,
    examName: user.exam_name,
    examDate: user.exam_date,
    startDate: user.start_date,
    days: user.days || [],
    streak: user.streak,
    longestStreak: user.longest_streak,
    lastStudyDate: user.last_study_date,
    achievements: user.achievements || [],
    heatmap: user.heatmap || {},
    scoreHistory: user.score_history || [],
    studySessions: user.study_sessions || [],
    revisionTracker: user.revision_tracker || {},
    pinnedSubjects: user.pinned_subjects || [],
    customVideos: user.custom_videos || {},
    subscription: user.subscription
  });
});

app.post('/api/sync', authenticate, async (req, res) => {
  const { examName, examDate, startDate, days, streak, longestStreak,
          lastStudyDate, achievements, heatmap, scoreHistory,
          studySessions, revisionTracker, pinnedSubjects, customVideos } = req.body;

  const update = {
    exam_name: examName,
    exam_date: examDate,
    start_date: startDate,
    days: days,
    streak: streak,
    longest_streak: longestStreak,
    last_study_date: lastStudyDate,
    achievements: achievements,
    heatmap: heatmap,
    score_history: scoreHistory,
    study_sessions: studySessions,
    revision_tracker: revisionTracker,
    pinned_subjects: pinnedSubjects || [],
    custom_videos: customVideos || {},
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase.from('users').update(update).eq('id', req.userId);
  if (error) {
    console.error('Sync error:', error.message);
    return res.status(500).json({ error: 'Sync failed' });
  }
  res.json({ success: true });
});

// ---- Leaderboard ----
app.get('/api/leaderboard', async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('email, username, streak, days')
    .order('streak', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  const board = (users || []).map((u, i) => ({
    rank: i + 1,
    name: u.username || u.email.split('@')[0],
    streak: u.streak || 0,
    completion: u.days ? (u.days.filter(d => d.status === 'done').length / u.days.length * 100).toFixed(0) : 0
  }));
  res.json(board);
});

// ---- Telegram link ----
app.post('/api/telegram/link', async (req, res) => {
  const { telegramId, username } = req.body;
  const { data: user } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { data: existing } = await supabase.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
  if (existing && existing.id !== user.id) {
    return res.status(400).json({ error: 'Telegram ID already linked to another account' });
  }

  const { error } = await supabase.from('users')
    .update({ telegram_id: telegramId, is_verified: true, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ---- Telegram unlink ----
app.delete('/api/telegram/unlink/:telegramId', async (req, res) => {
  const telegramId = parseInt(req.params.telegramId);
  const { data: user } = await supabase.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'No linked account found' });

  const { error } = await supabase.from('users')
    .update({ telegram_id: null, is_verified: false, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ---- Telegram notification on status change ----
app.post('/api/telegram/notify-status', authenticate, async (req, res) => {
  const { dayId, status } = req.body;
  const { data: user } = await supabase.from('users').select('*').eq('id', req.userId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.telegram_id) {
    return res.json({ success: false, message: 'Telegram not linked' });
  }
  const days = user.days || [];
  const day = days.find(d => Number(d.id) === Number(dayId));
  if (!day) return res.status(404).json({ error: 'Day not found' });

  let msg = '';
  if (status === 'progress') {
    msg = `⏳ *Good to know you have started!*\n\nI want to complete today's target:\n📚 *${day.topic}*\n📅 Day ${day.day}`;
  } else if (status === 'done') {
    msg = `✅ *Great! You have completed today's target!*\n\n📚 *${day.topic}*\n📅 Day ${day.day}\n\nKeep the streak going! 🔥`;
  } else {
    return res.json({ success: false, message: 'Invalid status' });
  }

  await sendTelegramMessage(user.telegram_id, msg);
  res.json({ success: true });
});

// ---- Bot endpoints (for the bot to fetch user data) ----
app.post('/api/bot/user/:telegramId/settings', botAuth, async (req, res) => {
  const telegramId = parseInt(req.params.telegramId);
  const { data: user } = await supabase.from('users').select('id, revision_tracker').eq('telegram_id', telegramId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const revisionTracker = user.revision_tracker || {};
  const existingBotSettings = revisionTracker.botSettings || defaultBotSettings();

  const newBotSettings = {
    dailyReminder: Boolean(req.body.dailyReminder),
    interval: Number(req.body.interval) || 30,
    morningTime: req.body.morningTime || existingBotSettings.morningTime || '05:00',
    eveningTime: req.body.eveningTime || existingBotSettings.eveningTime || '21:00',
    eveningCheckin: Boolean(req.body.eveningCheckin),
    weeklySummary: Boolean(req.body.weeklySummary),
    countdownAlerts: Boolean(req.body.countdownAlerts),
    missedAlerts: Boolean(req.body.missedAlerts),
    completionCheck: Boolean(req.body.completionCheck)
  };

  const updatedRevisionTracker = { ...revisionTracker, botSettings: newBotSettings };

  const { error } = await supabase.from('users')
    .update({
      revision_tracker: updatedRevisionTracker,
      updated_at: new Date().toISOString()
    })
    .eq('id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, settings: newBotSettings });
});

app.get('/api/bot/user/:telegramId', botAuth, async (req, res) => {
  const telegramId = parseInt(req.params.telegramId);
  const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegramId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const days = user.days || [];
  const done = days.filter(d => d.status === 'done').length;
  const total = days.length;
  const pct = total > 0 ? (done / total) * 100 : 0;
  const now = new Date();
  const exam = parseAppDate(user.exam_date || '2026-08-01');
  const daysLeft = Math.max(0, daysBetween(now, exam));
  const today = formatDate(now);
  let todayIdx = days.findIndex(d => d.date === today);
  if (todayIdx < 0) todayIdx = days.findIndex(d => d.status !== 'done');
  const todayDay = days[todayIdx] || days[0];
  const scores = days.filter(d => d.score && d.status === 'done').map(d => parseInt(d.score) || 0);
  const avgAcc = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  let streakFactor = 0;
  if (user.streak >= 30) streakFactor = 100;
  else if (user.streak >= 14) streakFactor = 80;
  else if (user.streak >= 7) streakFactor = 60;
  else if (user.streak >= 3) streakFactor = 40;
  else if (user.streak > 0) streakFactor = 20;

  let daysFactor = 100;
  if (daysLeft < 0) daysFactor = 100;
  else if (daysLeft < 7) daysFactor = 50;
  else if (daysLeft < 15) daysFactor = 70;
  else if (daysLeft < 30) daysFactor = 85;

  const readiness = Math.min(100, Math.round((pct * 0.4) + (avgAcc * 0.3) + (streakFactor * 0.2) + (daysFactor * 0.1)));

  const revisionTracker = user.revision_tracker || {};
  const botSettings = revisionTracker.botSettings || defaultBotSettings();

  res.json({
    username: user.username || user.email.split('@')[0],
    email: user.email,
    days: days,
    streak: user.streak,
    longestStreak: user.longest_streak,
    examDate: user.exam_date,
    daysLeft: daysLeft,
    readiness: readiness,
    avgHours: getAverageStudyHours(days),
    todayTopic: todayDay ? todayDay.topic : '',
    revisionTracker: revisionTracker,
    botSettings: botSettings
  });
});

app.get('/api/bot/today/:telegramId', botAuth, async (req, res) => {
  const telegramId = parseInt(req.params.telegramId);
  const { data: user } = await supabase.from('users').select('days').eq('telegram_id', telegramId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const days = user.days || [];
  const today = formatDate(new Date());
  let idx = days.findIndex(d => d.date === today);
  if (idx < 0) {
    idx = days.findIndex(d => d.status !== 'done');
    if (idx < 0) idx = days.length - 1;
  }
  const day = days[idx] || days[0];
  if (!day) return res.status(404).json({ error: 'No study plan found' });
  res.json({
    topic: day.topic,
    videos: day.videos || 0,
    files: day.files || 0,
    hours: (day.videos * 0.75 + day.files * 0.5).toFixed(1),
    day: day.day,
    totalDays: days.length
  });
});

app.get('/api/bot/users', botAuth, async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('telegram_id, username, email')
    .not('telegram_id', 'is', null);

  if (error) return res.status(500).json({ error: error.message });
  res.json(users || []);
});

app.get('/api/bot/leaderboard', botAuth, async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('email, username, streak, days')
    .order('streak', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  const board = (users || []).map((u, i) => {
    const total = u.days?.length || 0;
    const done = total ? u.days.filter(d => d.status === 'done').length : 0;
    return {
      rank: i + 1,
      username: u.username || u.email.split('@')[0],
      streak: u.streak || 0,
      completion: total ? Math.round((done / total) * 100) : 0
    };
  });
  res.json(board);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/db-health', async (req, res) => {
  try {
    const result = await supabaseQuery(() => supabase.from('users').select('id').limit(1));
    if (result.error) throw result.error;
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ---- Login with Telegram (after OTP verification) ----
app.post('/api/auth/login-telegram', async (req, res) => {
  const { telegramId } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  const { data: user } = await supabase.from('users')
    .select('id, email, username, telegram_id, subscription, is_verified')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (!user) {
    return res.status(404).json({ error: 'No account linked to this Telegram ID' });
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
  res.json({
    token,
    user: {
      email: user.email,
      username: user.username,
      telegramId: user.telegram_id,
      subscription: user.subscription,
      isVerified: user.is_verified
    }
  });
});

// ---- Serve frontend ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
//  START SERVER
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Fork the bot process
fork('./bot.js');

// ============================================================
//  KEEP-ALIVE PING (prevents Render free tier from sleeping)
// ============================================================

const PING_URL = process.env.API_URL || 'https://your-app-url.onrender.com';

setInterval(async () => {
  try {
    const response = await axios.get(PING_URL);
    console.log(`[Keep-Alive] Status: ${response.status}`);
  } catch (error) {
    console.error(`[Keep-Alive] Error: ${error.message}`);
  }
}, 300000); // 5 minutes
