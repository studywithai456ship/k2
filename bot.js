// ============================================================
// HYBRID V3 – QUANT TRACKER TELEGRAM BOT (Supabase backend)
// Production-grade with customizable reminder times + scheduler
// ============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// ------------------------------
// CONFIGURATION
// ------------------------------
const config = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  adminIds: (process.env.ADMIN_TELEGRAM_ID || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id),
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  webUrl: process.env.WEB_URL || process.env.API_URL || 'http://localhost:3000',
  apiToken: process.env.ADMIN_API_TOKEN,
  logDir: path.join(__dirname, 'logs'),
  logFile: path.join(__dirname, 'logs', 'errors.log'),
};

if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

// ------------------------------
// ADVANCED LOGGER
// ------------------------------
const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
let currentLogLevel = LOG_LEVELS.INFO;
const memoryLogs = [];

function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    stack: typeof meta.stack === 'string' ? meta.stack : '',
    statusCode: meta.statusCode || '',
    responseBody: typeof meta.responseBody === 'string' ? meta.responseBody : '',
  };
  memoryLogs.push(entry);
  if (memoryLogs.length > 1000) memoryLogs.shift();

  const consoleMsg = `[${timestamp}] [${level}] ${message}`;
  if (level === 'ERROR') console.error(consoleMsg);
  else if (level === 'WARN') console.warn(consoleMsg);
  else if (level === 'DEBUG') console.debug(consoleMsg);
  else console.log(consoleMsg);

  if (level === 'ERROR' || level === 'WARN') {
    const logLine = safeStringify(entry) + '\n';
    fs.appendFile(config.logFile, logLine, (err) => {
      if (err) console.error('Failed to write log file:', err);
    });
  }
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (key === 'req' || key === 'res' || key === 'socket' || key === 'connection') return '[circular]';
      if (typeof value === 'object' && value !== null) {
        try { JSON.stringify(value); }
        catch { return '[unserializable]'; }
      }
      return value;
    });
  } catch {
    return '{}';
  }
}

function logError(context, error) {
  const meta = {
    stack: error.stack || '',
    statusCode: error.response?.status || '',
    responseBody: typeof error.response?.data === 'object'
      ? safeStringify(error.response?.data)
      : String(error.response?.data || ''),
  };
  log('ERROR', `${context}: ${error.message}`, meta);
}

function logWarn(message, meta = {}) { log('WARN', message, meta); }
function logInfo(message, meta = {}) { log('INFO', message, meta); }
function logDebug(message, meta = {}) {
  if (currentLogLevel >= LOG_LEVELS.DEBUG) log('DEBUG', message, meta);
}

// ------------------------------
// UNHANDLED EXCEPTIONS / REJECTIONS
// ------------------------------
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
});
process.on('unhandledRejection', (reason, promise) => {
  logError('unhandledRejection', reason);
});

// ------------------------------
// BOT INITIALISATION
// ------------------------------
const bot = new TelegramBot(config.token, { polling: true });

// ------------------------------
// HELPER: SAFE MESSAGE EDIT / REPLY
// ------------------------------
async function editMessageOrReply(query, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (e) {
    logDebug('editMessageOrReply fallback to send', e);
    await bot.sendMessage(query.message.chat.id, text, {
      parse_mode: 'Markdown',
      ...options,
    });
  }
}

// ------------------------------
// DATE / TIME UTILITIES
// ------------------------------
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

// Validate 24-hour HH:MM format
function isValidTimeFormat(time) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

// Get current HH:MM in Indian Standard Time (IST, UTC+5:30)
function getCurrentTime() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (5.5 * 3600000));
  const hh = String(ist.getHours()).padStart(2, '0');
  const mm = String(ist.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Get current day of week (0=Sunday ... 6=Saturday) in IST
function getCurrentDayOfWeek() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (5.5 * 3600000));
  return ist.getDay();
}

// Get current date string (YYYY-MM-DD) in IST
function getCurrentISTDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (5.5 * 3600000));
  return ist.toISOString().split('T')[0];
}

// ------------------------------
// API HELPERS
// ------------------------------
async function apiCall(endpoint, method = 'GET', data = null) {
  const url = `${config.apiUrl}${endpoint}`;
  const headers = { Authorization: `Bearer ${config.apiToken}` };
  try {
    const res = await axios({ method, url, data, headers, timeout: 10000 });
    return { success: true, data: res.data };
  } catch (e) {
    logError(`apiCall ${endpoint}`, e);
    return { success: false, error: e.message, data: null };
  }
}

// ------------------------------
// SETTINGS (persisted via API → Supabase)
// ------------------------------
async function getUserSettings(telegramId) {
  const result = await apiCall(`/api/bot/user/${telegramId}`);
  if (!result.success || !result.data) return null;

  const data = result.data;
  const botSettings = data.botSettings || data.revisionTracker?.botSettings || {};

  return {
    dailyReminder: botSettings.dailyReminder ?? false,
    interval: botSettings.interval ?? 30,
    morningTime: botSettings.morningTime ?? '05:00',
    eveningTime: botSettings.eveningTime ?? '21:00',
    eveningCheckin: botSettings.eveningCheckin ?? false,
    weeklySummary: botSettings.weeklySummary ?? false,
    countdownAlerts: botSettings.countdownAlerts ?? false,
    missedAlerts: botSettings.missedAlerts ?? false,
    completionCheck: botSettings.completionCheck ?? false,
  };
}

async function updateUserSettings(telegramId, settings) {
  return await apiCall(`/api/bot/user/${telegramId}/settings`, 'POST', settings);
}

// ------------------------------
// ADMIN TOGGLES (fetched from API)
// ------------------------------
async function getAdminToggles() {
  const result = await apiCall('/api/admin/toggles');
  if (!result.success || !result.data) return { freeEnabled: false, devEnabled: false };
  return { freeEnabled: result.data.freeEnabled ?? false, devEnabled: result.data.devEnabled ?? false };
}

async function setAdminToggle(key, value) {
  return await apiCall(`/api/admin/toggle`, 'POST', { key, value });
}

// ------------------------------
// BROADCAST STORAGE (module-level)
// ------------------------------
const broadcastCache = new Map();

// ------------------------------
// KEYBOARDS
// ------------------------------
function getMainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📅 Today', callback_data: 'menu_today' }, { text: '📊 Status', callback_data: 'menu_status' }],
        [{ text: '🔥 Streak', callback_data: 'menu_streak' }, { text: '⏳ Countdown', callback_data: 'menu_countdown' }],
        [{ text: '📈 Analytics', callback_data: 'menu_analytics' }, { text: '🏆 Leaderboard', callback_data: 'menu_leaderboard' }],
        [{ text: '⚙ Settings', callback_data: 'menu_settings' }, { text: '📚 Help', callback_data: 'menu_help' }],
        [{ text: '🛟 Support', callback_data: 'menu_support' }, { text: '🌐 Open Website', url: config.webUrl }],
      ],
    },
  };
}

function getAdminPanelKeyboard(freeEnabled, devEnabled) {
  const freeLabel = freeEnabled ? '🔓 Leaderboard: ON' : '🔒 Leaderboard: OFF';
  const devLabel = devEnabled ? '⚙️ Dev Mode: ON' : '⚙️ Dev Mode: OFF';
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: freeLabel, callback_data: 'admin_toggle_free' }],
        [{ text: devLabel, callback_data: 'admin_toggle_dev' }],
        [{ text: '📋 View Logs', callback_data: 'admin_view_logs' }],
        [{ text: '🗑 Clear Logs', callback_data: 'admin_clear_logs' }],
        [{ text: '📤 Export Logs', callback_data: 'admin_export_logs' }],
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '👥 Total Users', callback_data: 'admin_total_users' }],
        [{ text: '📈 Active Users', callback_data: 'admin_active_users' }],
        [{ text: '❤️ Health Check', callback_data: 'admin_health' }],
        [{ text: '🔄 Refresh', callback_data: 'admin_refresh' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }],
      ],
    },
  };
}

function getSettingsKeyboard(settings) {
  const dailyLabel = settings.dailyReminder
    ? `🌅 Daily ${settings.morningTime}: ON`
    : `🌅 Daily ${settings.morningTime}: OFF`;
  const intervalLabel = `⏱️ Interval: ${settings.interval} min`;
  const eveningLabel = settings.eveningCheckin
    ? `🌙 Evening ${settings.eveningTime}: ON`
    : `🌙 Evening ${settings.eveningTime}: OFF`;
  const completionLabel = settings.completionCheck ? '✅ Completion Check: ON' : '✅ Completion Check: OFF';
  const countdownLabel = settings.countdownAlerts ? '⏳ Countdown Alerts: ON' : '⏳ Countdown Alerts: OFF';
  const missedLabel = settings.missedAlerts ? '⚠️ Missed Alerts: ON' : '⚠️ Missed Alerts: OFF';
  const weeklyLabel = settings.weeklySummary ? '📊 Weekly Summary: ON' : '📊 Weekly Summary: OFF';
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: dailyLabel, callback_data: 'us_toggle_daily' }],
        [{ text: '🕐 Set Morning Time', callback_data: 'us_set_morning' }],
        [{ text: intervalLabel, callback_data: 'us_interval' }],
        [{ text: eveningLabel, callback_data: 'us_toggle_evening' }],
        [{ text: '🕐 Set Evening Time', callback_data: 'us_set_evening' }],
        [{ text: completionLabel, callback_data: 'us_toggle_completion' }],
        [{ text: countdownLabel, callback_data: 'us_toggle_countdown' }],
        [{ text: missedLabel, callback_data: 'us_toggle_missed' }],
        [{ text: weeklyLabel, callback_data: 'us_toggle_weekly' }],
        [{ text: '🌐 Open Website', url: config.webUrl }],
        [{ text: '🔙 Main Menu', callback_data: 'us_back_main' }],
      ],
    },
  };
}

// Keyboard for entering a custom time (prompts user to type HH:MM)
function getTimeSetKeyboard(action) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '05:00', callback_data: `us_${action}_05:00` }],
        [{ text: '06:00', callback_data: `us_${action}_06:00` }],
        [{ text: '07:00', callback_data: `us_${action}_07:00` }],
        [{ text: '08:00', callback_data: `us_${action}_08:00` }],
        [{ text: '18:00', callback_data: `us_${action}_18:00` }],
        [{ text: '20:00', callback_data: `us_${action}_20:00` }],
        [{ text: '21:00', callback_data: `us_${action}_21:00` }],
        [{ text: '22:00', callback_data: `us_${action}_22:00` }],
        [{ text: '🔙 Back', callback_data: 'us_back_settings' }],
      ],
    },
  };
}

// ------------------------------
// FORMATTING HELPERS
// ------------------------------
function buildProgressBar(percent, length = 10) {
  const filled = Math.floor(percent / 10);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function buildStreakBar(streak, length = 10) {
  const progress = streak % 10;
  return '🔥'.repeat(progress) + '⬜'.repeat(length - progress);
}

function getMotivationMessage(streak) {
  if (streak >= 30) return '🌟 *Legendary!* Keep it up!';
  if (streak >= 20) return '💪 *Amazing!* You\'re unstoppable!';
  if (streak >= 10) return '👍 *Great!* Stay consistent!';
  return '💪 *Keep going!* Every day counts!';
}

function getReadinessStatus(readiness) {
  if (readiness >= 80) return '✅ ON TRACK';
  if (readiness >= 60) return '⚠️ BEHIND';
  return '🚨 URGENT';
}

// ------------------------------
// COMMAND HANDLER FUNCTIONS
// ------------------------------
async function handleToday(chatId, userId) {
  const result = await apiCall(`/api/bot/today/${userId}`);
  if (!result.success || !result.data || !result.data.topic) {
    return bot.sendMessage(chatId, `❌ *No study plan found.* Please link your account with /link first.`);
  }
  const { topic, videos, files, hours, day, totalDays } = result.data;
  const reply =
    `🌅 *Today's Study Target*\n\n` +
    `📚 *Topic:* ${topic}\n` +
    `🎬 Videos: ${videos}\n` +
    `📁 Practice files: ${files}\n` +
    `⏱️ Estimated time: ~${hours} hours\n` +
    `📅 Day ${day} of ${totalDays || 'your plan'}`;
  return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
}

async function handleStatus(chatId, userId) {
  const result = await apiCall(`/api/bot/user/${userId}`);
  if (!result.success || !result.data) {
    return bot.sendMessage(chatId, '❌ No data found. Link with /link.');
  }
  const data = result.data;
  const done = data.days?.filter(d => d.status === 'done').length || 0;
  const total = data.days?.length || 1;
  const pct = Math.round((done / total) * 100);
  const bar = buildProgressBar(pct);
  const reply =
    `📊 *Your Progress*\n\n` +
    `👤 *User:* @${data.username || 'unknown'}\n` +
    `\`${bar}\` *${pct}%*\n\n` +
    `📈 *Completion:* ${done}/${total} days\n` +
    `🔥 *Streak:* ${data.streak || 0} days\n` +
    `🏆 *Readiness:* ${data.readiness || 0}%\n` +
    `📅 *Exam:* ${data.examDate || 'Not set'}\n` +
    `⏳ *Days left:* ${data.daysLeft || 'N/A'}\n` +
    `📚 *Today's topic:* ${data.todayTopic || '—'}`;
  return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
}

async function handleStreak(chatId, userId) {
  const result = await apiCall(`/api/bot/user/${userId}`);
  if (!result.success || !result.data) {
    return bot.sendMessage(chatId, '❌ No data.');
  }
  const data = result.data;
  const streak = data.streak || 0;
  const longest = data.longestStreak || 0;
  const nextMilestone = Math.ceil(streak / 10) * 10;
  const bar = buildStreakBar(streak);
  const motivation = getMotivationMessage(streak);
  const msgText =
    `🔥 *Streak Report*\n\n` +
    `*Current:* ${streak} days\n` +
    `*Longest:* ${longest} days\n` +
    `*Next milestone:* ${nextMilestone} days\n\n` +
    `${bar}\n\n` +
    motivation;
  return bot.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
}

async function handleCountdown(chatId, userId) {
  const result = await apiCall(`/api/bot/user/${userId}`);
  if (!result.success || !result.data || !result.data.examDate) {
    return bot.sendMessage(chatId, '❌ Exam date not set.');
  }
  const data = result.data;
  const exam = parseAppDate(data.examDate);
  const now = new Date();
  const diff = exam - now;
  if (diff <= 0) {
    return bot.sendMessage(chatId, '🎯 *Exam date has passed!* Good luck!');
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const readiness = data.readiness || 0;
  const status = getReadinessStatus(readiness);
  const bar = buildProgressBar(readiness);
  const reply =
    `⏳ *Exam Countdown*\n\n` +
    `*${days}d ${hours}h ${mins}m ${secs}s* remaining\n\n` +
    `📊 *Preparation:* ${readiness}%\n` +
    `\`${bar}\`\n\n` +
    `📈 *Status:* ${status}`;
  return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
}

async function handleAnalytics(chatId, userId) {
  const result = await apiCall(`/api/bot/user/${userId}`);
  if (!result.success || !result.data) {
    return bot.sendMessage(chatId, '❌ No data.');
  }
  const data = result.data;
  const done = data.days?.filter(d => d.status === 'done').length || 0;
  const skipped = data.days?.filter(d => d.status === 'skipped').length || 0;
  const total = data.days?.length || 1;
  const avgHours = data.avgHours || 0;
  const pct = Math.round((done / total) * 100);
  const bar = buildProgressBar(pct);
  const reply =
    `📈 *Detailed Analytics*\n\n` +
    `📅 *Total study days:* ${total}\n` +
    `✅ *Completed:* ${done}\n` +
    `❌ *Skipped:* ${skipped}\n` +
    `🔥 *Current streak:* ${data.streak || 0}\n` +
    `🏆 *Longest streak:* ${data.longestStreak || 0}\n` +
    `⏱️ *Avg hours/day:* ${avgHours.toFixed(1)}\n` +
    `🏅 *Readiness:* ${data.readiness || 0}%\n` +
    `\`${bar}\` *${pct}%*`;
  return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
}

async function handleLeaderboard(chatId) {
  const toggles = await getAdminToggles();
  if (!toggles.freeEnabled) {
    return bot.sendMessage(chatId, '🔒 *Leaderboard is currently disabled* by admin.');
  }
  const result = await apiCall('/api/bot/leaderboard');
  if (!result.success || !result.data || !result.data.length) {
    return bot.sendMessage(chatId, '🏆 *No users yet.* Be the first!');
  }
  let reply = '🏆 *Leaderboard (Top 10)*\n\n';
  result.data.slice(0, 10).forEach((u, i) => {
    reply += `${i + 1}. @${u.username} – *${u.completion}%* (🔥${u.streak})\n`;
  });
  return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
}

async function handleSettings(chatId, userId) {
  const settings = await getUserSettings(userId);
  if (!settings) {
    return bot.sendMessage(chatId, '❌ *Please link your account first* with /link.');
  }
  const text =
    `🔔 *Notification Settings*\n\n` +
    `🌅 Daily ${settings.morningTime}: *${settings.dailyReminder ? 'ON' : 'OFF'}*\n` +
    `⏱️ Interval: *${settings.interval} min*\n` +
    `🌙 Evening ${settings.eveningTime}: *${settings.eveningCheckin ? 'ON' : 'OFF'}*\n` +
    `✅ Completion Check: *${settings.completionCheck ? 'ON' : 'OFF'}*\n` +
    `⏳ Countdown Alerts: *${settings.countdownAlerts ? 'ON' : 'OFF'}*\n` +
    `⚠️ Missed Alerts: *${settings.missedAlerts ? 'ON' : 'OFF'}*\n` +
    `📊 Weekly Summary: *${settings.weeklySummary ? 'ON' : 'OFF'}*\n\n` +
    `_Tap a button below to toggle or customize reminder times._`;
  return bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    ...getSettingsKeyboard(settings),
  });
}

async function handleHelp(chatId, userId) {
  const commands = [
    '*/start* – Welcome & main menu',
    '*/help* – This help',
    '*/link* <username> – Connect your account',
    '*/unlink* – Disconnect your account',
    '*/myid* – Show your Telegram user ID',
    '*/today* – Today\'s study target',
    '*/status* – Your progress overview',
    '*/streak* – Current streak & milestones',
    '*/countdown* – Exam countdown timer',
    '*/analytics* – Detailed statistics',
    '*/leaderboard* – Top performers (if enabled)',
    '*/us* – Notification settings',
    '*/settime* – Quick-set reminder times',
    '*/support* – How the bot works & feature guide',
  ];
  if (config.adminIds.includes(String(userId))) {
    commands.push('*/admin_panel* – Admin dashboard');
    commands.push('*/broadcast* – Send a broadcast');
    commands.push('*/log* – View error logs');
    commands.push('*/restart* – Restart bot polling');
  }
  return bot.sendMessage(chatId, `📚 *Command List*\n\n${commands.join('\n')}\n\n_Click the buttons below for quick actions._`, {
    parse_mode: 'Markdown',
    ...getMainMenuKeyboard()
  });
}

async function handleSupport(chatId) {
  const text =
    `🛟 *Quant Tracker Bot — Support & Feature Guide*\n\n` +
    `Quant Tracker is your personal exam-prep companion. The bot mirrors your web dashboard so you can track progress, stay motivated, and never miss a study day — right from Telegram.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 *GETTING STARTED*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `1️⃣ Register on the web app using your Telegram ID + OTP.\n` +
    `2️⃣ Run \`/link <username>\` here to connect this chat to your account.\n` +
    `3️⃣ Use the menu buttons or commands below to track your prep.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *CORE COMMANDS*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• \`/today\` — Today's study target (topic, videos, files, est. time).\n` +
    `• \`/status\` — Progress overview: completion %, streak, readiness, days left.\n` +
    `• \`/streak\` — Current & longest streak, next milestone, motivation.\n` +
    `• \`/countdown\` — Live exam countdown (days/hours/min/sec) + readiness bar.\n` +
    `• \`/analytics\` — Detailed stats: completed, skipped, avg hours/day, readiness.\n` +
    `• \`/leaderboard\` — Top 10 performers (admin can enable/disable this).\n` +
    `• \`/myid\` — Shows your numeric Telegram ID (needed for linking).\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔔 *NOTIFICATION SETTINGS* (\`/us\`)\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `All settings below are saved to your account in Supabase and persist across sessions. Toggle them with the inline buttons:\n\n` +
    `• 🌅 *Daily Morning Reminder* — A morning push with today's target. *Customizable time* (24h HH:MM format, default 05:00). Use the "Set Morning Time" button or \`/settime morning HH:MM\`.\n` +
    `• ⏱️ *Interval Reminders* — Nudge every N minutes (30/60/90/105/120/150/180) while a task is in progress.\n` +
    `• 🌙 *Evening Check-in* — An end-of-day prompt to mark your task done. *Customizable time* (24h HH:MM format, default 21:00). Use the "Set Evening Time" button or \`/settime evening HH:MM\`.\n` +
    `• ✅ *Completion Check* — Confirmation when you mark a task as done.\n` +
    `• ⏳ *Countdown Alerts* — Periodic exam-countdown updates as the date approaches.\n` +
    `• ⚠️ *Missed Alerts* — Warning if you missed a day, so you can snooze/shift the schedule.\n` +
    `• 📊 *Weekly Summary* — A weekly recap of your progress, streak, and readiness.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 *CUSTOMIZING REMINDER TIMES*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `You can set any time in 24-hour HH:MM format:\n` +
    `• \`/settime morning 06:30\` — Morning reminder at 6:30 AM\n` +
    `• \`/settime evening 22:00\` — Evening check-in at 10 PM\n` +
    `• Or use the inline buttons in \`/us\` → "Set Morning Time" / "Set Evening Time"\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `⚙️ *HOW IT WORKS BEHIND THE SCENES*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• Your study plan, streaks, scores, and bot settings are stored in Supabase (PostgreSQL) via the web app's API.\n` +
    `• The bot reads your data using your Telegram ID — so the same account works on web and Telegram.\n` +
    `• When you toggle a setting, it's saved to \`revision_tracker.bot_settings\` on your user record in Supabase.\n` +
    `• Status changes you make on the web (todo → progress → done) trigger a Telegram notification here.\n` +
    `• A built-in scheduler checks every minute for due reminders and sends them automatically.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🆘 *TROUBLESHOOTING*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `• Settings not saving? Run \`/link <username>\` again to refresh the connection.\n` +
    `• No data showing? Make sure you've registered on the web app first.\n` +
    `• Bot not responding? Try \`/restart\` (admin) or wait a moment — polling auto-recovers.\n\n` +
    `_Need more help? Contact the admin via the web app support channel._`;
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

// ------------------------------
// COMMAND HANDLERS
// ------------------------------

// /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `🎯 *Welcome to Quant Tracker Bot V3!*\n\n` +
    `I'm your study companion. Track your daily targets, streaks, and exam readiness.\n\n` +
    `🔹 *Quick start:* Use /link <username> to connect your account.\n` +
    `🔹 Explore the menu below to get started. 👇`,
    getMainMenuKeyboard()
  );
});

// /help
bot.onText(/\/help/, (msg) => {
  handleHelp(msg.chat.id, msg.from.id);
});

// /link
bot.onText(/\/link (.+)/, async (msg, match) => {
  const username = match[1].trim().replace(/[@\s]/g, '');
  const chatId = msg.chat.id;

  if (!username || username.length < 2) {
    return bot.sendMessage(chatId, '❌ *Invalid username.* Please provide a valid username.');
  }

  try {
    const result = await apiCall('/api/telegram/link', 'POST', {
      telegramId: msg.from.id,
      username: username,
    });

    if (result.success) {
      bot.sendMessage(chatId, `✅ *Success!* Your Telegram is now linked to @${username}.\nYou can now use all bot features.`);
    } else {
      bot.sendMessage(chatId, `❌ *Link failed.* ${result.error || 'Please check that the username is correct and you\'ve registered on the web app.'}`);
    }
  } catch (e) {
    logError('/link', e);
    bot.sendMessage(chatId, `⚠️ *An error occurred.* Please try again later.`);
  }
});

// /unlink
bot.onText(/\/unlink/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const result = await apiCall(`/api/telegram/unlink/${userId}`, 'DELETE');
    if (result.success && result.data?.success) {
      bot.sendMessage(chatId, `✅ *Unlinked successfully.* Your account is no longer connected.`);
    } else {
      bot.sendMessage(chatId, `❌ No linked account found or failed to unlink.`);
    }
  } catch (e) {
    logError('/unlink', e);
    bot.sendMessage(chatId, `⚠️ An error occurred while unlinking. Please try again later.`);
  }
});

// /myid
bot.onText(/\/myid/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  bot.sendMessage(
    chatId,
    `🆔 *Your Telegram ID*\n\n` +
    `\`${userId}\`\n\n` +
    `_You can use this ID when contacting support or for configuration._`,
    { parse_mode: 'Markdown' }
  );
});

// /settime <morning|evening> <HH:MM>  — quick-set reminder times
bot.onText(/\/settime\s+(morning|evening)\s+([01]\d|2[0-3]):([0-5]\d)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const which = match[1].toLowerCase();
  const time = `${match[2]}:${match[3]}`;

  const settings = await getUserSettings(userId);
  if (!settings) {
    return bot.sendMessage(chatId, '❌ *Please link your account first* with /link.');
  }

  if (which === 'morning') {
    settings.morningTime = time;
  } else {
    settings.eveningTime = time;
  }

  const result = await updateUserSettings(userId, settings);
  if (result.success) {
    bot.sendMessage(
      chatId,
      `✅ *${which === 'morning' ? 'Morning' : 'Evening'} reminder time set to ${time}.*\n\n` +
      `Current settings:\n` +
      `🌅 Morning: ${settings.morningTime} (${settings.dailyReminder ? 'ON' : 'OFF'})\n` +
      `🌙 Evening: ${settings.eveningTime} (${settings.eveningCheckin ? 'ON' : 'OFF'})`,
      { parse_mode: 'Markdown' }
    );
  } else {
    bot.sendMessage(chatId, '❌ Failed to save time. Please try again.');
  }
});

// /settime (no args) — show usage
bot.onText(/^\/settime$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🕐 *Set Reminder Time*\n\n` +
    `Usage:\n` +
    `• \`/settime morning 06:30\` — Set morning reminder to 6:30 AM\n` +
    `• \`/settime evening 22:00\` — Set evening check-in to 10:00 PM\n\n` +
    `Format: 24-hour HH:MM (00:00 to 23:59)`,
    { parse_mode: 'Markdown' }
  );
});

// /restart (admin only)
bot.onText(/\/restart/, async (msg) => {
  const chatId = msg.chat.id;
  if (!config.adminIds.includes(String(msg.from.id))) {
    return bot.sendMessage(chatId, '⛔ *Admin only.*');
  }
  try {
    await bot.sendMessage(chatId, '🔄 *Restarting bot polling...*');
    bot.stopPolling();
    setTimeout(async () => {
      bot.startPolling();
      await bot.sendMessage(chatId, '✅ *Polling restarted successfully.*');
    }, 1000);
  } catch (e) {
    logError('/restart', e);
    bot.sendMessage(chatId, '❌ Failed to restart polling.');
  }
});

// /today
bot.onText(/\/today/, (msg) => {
  handleToday(msg.chat.id, msg.from.id);
});

// /status
bot.onText(/\/status/, (msg) => {
  handleStatus(msg.chat.id, msg.from.id);
});

// /streak
bot.onText(/\/streak/, (msg) => {
  handleStreak(msg.chat.id, msg.from.id);
});

// /countdown
bot.onText(/\/countdown/, (msg) => {
  handleCountdown(msg.chat.id, msg.from.id);
});

// /analytics
bot.onText(/\/analytics/, (msg) => {
  handleAnalytics(msg.chat.id, msg.from.id);
});

// /leaderboard
bot.onText(/\/leaderboard/, (msg) => {
  handleLeaderboard(msg.chat.id);
});

// /us – settings
bot.onText(/\/us/, (msg) => {
  handleSettings(msg.chat.id, msg.from.id);
});

// /support
bot.onText(/\/support/, (msg) => {
  handleSupport(msg.chat.id);
});

// /admin_panel
bot.onText(/\/admin_panel/, async (msg) => {
  if (!config.adminIds.includes(String(msg.from.id))) {
    return bot.sendMessage(msg.chat.id, '⛔ *Admin only.*');
  }
  const toggles = await getAdminToggles();
  bot.sendMessage(
    msg.chat.id,
    '⚡ *Admin Control Panel*\n\nChoose an action below:',
    {
      parse_mode: 'Markdown',
      ...getAdminPanelKeyboard(toggles.freeEnabled, toggles.devEnabled),
    }
  );
});

// /broadcast – admin command
bot.onText(/\/broadcast/, async (msg) => {
  if (!config.adminIds.includes(String(msg.from.id))) return;
  const text = msg.text.replace('/broadcast', '').trim();
  if (!text) return bot.sendMessage(msg.chat.id, '📢 *Usage:* `/broadcast <message>`');

  const confirmKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Yes, send', callback_data: 'broadcast_confirm' }],
        [{ text: '❌ Cancel', callback_data: 'broadcast_cancel' }],
      ],
    },
  };

  broadcastCache.set(msg.from.id, text);
  bot.sendMessage(
    msg.chat.id,
    `📢 *Broadcast Preview*\n\n` +
    `_You are about to send this message to all users:_\n\n` +
    `${text}\n\n` +
    `Proceed?`,
    confirmKeyboard
  );
});

// /log – admin log view
bot.onText(/\/log/, async (msg) => {
  if (!config.adminIds.includes(String(msg.from.id))) return;

  try {
    const data = await fsp.readFile(config.logFile, 'utf8').catch(() => '');
    const lines = data.split('\n').filter(l => l.trim()).slice(-20);

    if (lines.length === 0) {
      return bot.sendMessage(msg.chat.id, '✅ *No errors logged.*');
    }

    const formattedLogs = lines.map(line => {
      try {
        const entry = JSON.parse(line);
        return `🕐 ${entry.timestamp}\n⚠️ ${entry.level}: ${entry.message}`;
      } catch {
        return line;
      }
    }).join('\n\n');

    await bot.sendMessage(msg.chat.id, `📋 *Last 20 errors:*\n\n${formattedLogs}`, { parse_mode: 'Markdown' });
  } catch (e) {
    logError('/log', e);
    bot.sendMessage(msg.chat.id, '❌ Failed to read log file.');
  }
});

// ------------------------------
// CALLBACK QUERY HANDLER
// ------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    // ---- Broadcast confirmation ----
    if (data === 'broadcast_confirm') {
      if (!config.adminIds.includes(String(userId))) {
        return bot.sendMessage(chatId, '⛔ *Admin only.*');
      }
      const text = broadcastCache.get(userId);
      if (!text) {
        return bot.sendMessage(chatId, '❌ No broadcast message found. Use /broadcast again.');
      }
      const result = await apiCall('/api/bot/users');
      if (!result.success || !result.data || !result.data.length) {
        return bot.sendMessage(chatId, '❌ No users found to broadcast to.');
      }
      let success = 0, failed = 0;
      for (const user of result.data) {
        try {
          await bot.sendMessage(user.telegram_id, `📢 *Broadcast*\n\n${text}`, { parse_mode: 'Markdown' });
          success++;
        } catch (e) {
          failed++;
          logError(`broadcast to ${user.telegram_id}`, e);
        }
        await new Promise(r => setTimeout(r, 50));
      }
      broadcastCache.delete(userId);
      return bot.sendMessage(
        chatId,
        `✅ *Broadcast completed*\n\n` +
        `✅ Delivered: ${success}\n` +
        `❌ Failed: ${failed}`
      );
    }

    if (data === 'broadcast_cancel') {
      broadcastCache.delete(userId);
      return bot.sendMessage(chatId, '❌ *Broadcast cancelled.*');
    }

    // ---- Menu callbacks ----
    if (data === 'menu_today') return await handleToday(chatId, userId);
    if (data === 'menu_status') return await handleStatus(chatId, userId);
    if (data === 'menu_streak') return await handleStreak(chatId, userId);
    if (data === 'menu_countdown') return await handleCountdown(chatId, userId);
    if (data === 'menu_analytics') return await handleAnalytics(chatId, userId);
    if (data === 'menu_leaderboard') return await handleLeaderboard(chatId);
    if (data === 'menu_settings') return await handleSettings(chatId, userId);
    if (data === 'menu_help') return await handleHelp(chatId, userId);
    if (data === 'menu_support') return await handleSupport(chatId);
    if (data === 'us_back_main') {
      return bot.sendMessage(chatId, '🔙 *Main Menu*', getMainMenuKeyboard());
    }

    // ---- Admin panel callbacks ----
    if (data.startsWith('admin_')) {
      if (!config.adminIds.includes(String(userId))) {
        return bot.sendMessage(chatId, '⛔ *Admin only.*');
      }

      if (data === 'admin_toggle_free') {
        const toggles = await getAdminToggles();
        await setAdminToggle('freeEnabled', !toggles.freeEnabled);
        const updated = await getAdminToggles();
        return await editMessageOrReply(query, '⚡ *Admin Control Panel*', getAdminPanelKeyboard(updated.freeEnabled, updated.devEnabled));
      }

      if (data === 'admin_toggle_dev') {
        const toggles = await getAdminToggles();
        await setAdminToggle('devEnabled', !toggles.devEnabled);
        const updated = await getAdminToggles();
        return await editMessageOrReply(query, '⚡ *Admin Control Panel*', getAdminPanelKeyboard(updated.freeEnabled, updated.devEnabled));
      }

      if (data === 'admin_refresh') {
        const toggles = await getAdminToggles();
        return await editMessageOrReply(query, '⚡ *Admin Control Panel*', getAdminPanelKeyboard(toggles.freeEnabled, toggles.devEnabled));
      }

      if (data === 'admin_view_logs') {
        const logs = memoryLogs.slice(-20).map(l => `🕐 ${l.timestamp}\n${l.level}: ${l.message}`).join('\n\n');
        const msgText = logs || '📭 *No logs in memory.*';
        return await bot.sendMessage(chatId, `📋 *Recent Logs*\n\n${msgText}`, { parse_mode: 'Markdown' });
      }

      if (data === 'admin_clear_logs') {
        try {
          await fsp.writeFile(config.logFile, '');
          memoryLogs.length = 0;
          return await bot.sendMessage(chatId, '🗑️ *Logs cleared successfully.*');
        } catch (e) {
          logError('clear logs', e);
          return await bot.sendMessage(chatId, '❌ Failed to clear logs.');
        }
      }

      if (data === 'admin_export_logs') {
        try {
          if (fs.existsSync(config.logFile)) {
            return await bot.sendDocument(chatId, config.logFile, { caption: '📤 Error Logs Export' });
          }
          return await bot.sendMessage(chatId, '❌ No log file to export.');
        } catch (e) {
          logError('export logs', e);
          return await bot.sendMessage(chatId, '❌ Failed to export logs.');
        }
      }

      if (data === 'admin_broadcast') {
        return await bot.sendMessage(chatId, '📢 Send broadcast with:\n`/broadcast <your message>`', { parse_mode: 'Markdown' });
      }

      if (data === 'admin_total_users') {
        const result = await apiCall('/api/bot/users');
        return await bot.sendMessage(chatId, `👥 *Total Users:* ${result.data?.length || 0}`);
      }

      if (data === 'admin_active_users') {
        const result = await apiCall('/api/bot/users?active=true');
        return await bot.sendMessage(chatId, `📈 *Active Users (7d):* ${result.data?.length || 0}`);
      }

      if (data === 'admin_health') {
        const uptime = process.uptime();
        const mem = process.memoryUsage();
        const nodeVer = process.version;
        const apiResult = await apiCall('/api/health');
        const dbResult = await apiCall('/api/db-health');
        const apiStatus = apiResult.success ? '✅' : '❌';
        const dbStatus = dbResult.success ? '✅' : '❌';
        const errors = memoryLogs.filter(l => l.level === 'ERROR').length;
        const warn = memoryLogs.filter(l => l.level === 'WARN').length;
        const healthMsg =
          `❤️ *Health Check*\n\n` +
          `🤖 *Bot Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n` +
          `💾 *Memory:* ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
          `📦 *Node:* ${nodeVer}\n` +
          `🔗 *API:* ${apiStatus}\n` +
          `🗄️ *DB:* ${dbStatus}\n` +
          `⚠️ *Errors:* ${errors}\n` +
          `⚠️ *Warnings:* ${warn}`;
        return await bot.sendMessage(chatId, healthMsg, { parse_mode: 'Markdown' });
      }

      if (data === 'admin_back') {
        return bot.sendMessage(chatId, '🔙 *Main Menu*', getMainMenuKeyboard());
      }
    }

    // ---- User settings callbacks ----
    if (data.startsWith('us_')) {
      const settings = await getUserSettings(userId);
      if (!settings) {
        return bot.sendMessage(chatId, '❌ Please link your account first.');
      }

      if (data === 'us_toggle_daily') {
        settings.dailyReminder = !settings.dailyReminder;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      if (data === 'us_toggle_evening') {
        settings.eveningCheckin = !settings.eveningCheckin;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      if (data === 'us_toggle_completion') {
        settings.completionCheck = !settings.completionCheck;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      if (data === 'us_toggle_countdown') {
        settings.countdownAlerts = !settings.countdownAlerts;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      if (data === 'us_toggle_missed') {
        settings.missedAlerts = !settings.missedAlerts;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      if (data === 'us_toggle_weekly') {
        settings.weeklySummary = !settings.weeklySummary;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
      }

      // Set morning time — show preset keyboard
      if (data === 'us_set_morning') {
        return await editMessageOrReply(
          query,
          '🕐 *Set Morning Reminder Time*\n\nChoose a preset or use `/settime morning HH:MM` for a custom time.',
          { ...getTimeSetKeyboard('morning'), parse_mode: 'Markdown' }
        );
      }

      // Set evening time — show preset keyboard
      if (data === 'us_set_evening') {
        return await editMessageOrReply(
          query,
          '🕐 *Set Evening Check-in Time*\n\nChoose a preset or use `/settime evening HH:MM` for a custom time.',
          { ...getTimeSetKeyboard('evening'), parse_mode: 'Markdown' }
        );
      }

      // Parse morning/evening time selection: us_morning_HH:MM or us_evening_HH:MM
      const morningMatch = data.match(/^us_morning_([01]\d|2[0-3]):([0-5]\d)$/);
      if (morningMatch) {
        settings.morningTime = `${morningMatch[1]}:${morningMatch[2]}`;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, `✅ *Morning time set to ${settings.morningTime}.*`, getSettingsKeyboard(settings));
      }

      const eveningMatch = data.match(/^us_evening_([01]\d|2[0-3]):([0-5]\d)$/);
      if (eveningMatch) {
        settings.eveningTime = `${eveningMatch[1]}:${eveningMatch[2]}`;
        await updateUserSettings(userId, settings);
        return await editMessageOrReply(query, `✅ *Evening time set to ${settings.eveningTime}.*`, getSettingsKeyboard(settings));
      }

      if (data === 'us_interval') {
        const intervals = [30, 60, 90, 105, 120, 150, 180];
        const keyboard = intervals.map(val => [{
          text: `${val} min${settings.interval === val ? ' ✅' : ''}`,
          callback_data: `us_set_interval_${val}`,
        }]);
        keyboard.push([{ text: '🔙 Back', callback_data: 'us_back_settings' }]);
        return await editMessageOrReply(query, '⏱️ *Select reminder interval*', {
          reply_markup: { inline_keyboard: keyboard },
          parse_mode: 'Markdown',
        });
      }

      const intervalMatch = data.match(/^us_set_interval_(\d+)$/);
      if (intervalMatch) {
        const val = parseInt(intervalMatch[1], 10);
        if (!isNaN(val) && val > 0) {
          settings.interval = val;
          await updateUserSettings(userId, settings);
          return await editMessageOrReply(query, '🔔 *Settings updated.*', getSettingsKeyboard(settings));
        }
      }

      if (data === 'us_back_settings') {
        const currentSettings = await getUserSettings(userId);
        if (currentSettings) {
          return await editMessageOrReply(query, '🔔 *Notification Settings*', getSettingsKeyboard(currentSettings));
        }
      }
    }
  } catch (err) {
    logError('callback_query', err);
    bot.sendMessage(chatId, '⚠️ *An error occurred.* Please try again later.');
  }
});

// ============================================================
//  REMINDER SCHEDULER
//  Checks every 60 seconds for due reminders
// ============================================================

const sentReminders = new Map(); // key: `${telegramId}:${type}:${date}` → prevents duplicates per day

async function runReminderScheduler() {
  const currentTime = getCurrentTime();
  const today = getCurrentISTDate();
  const dayOfWeek = getCurrentDayOfWeek();

  logDebug(`Scheduler tick: ${currentTime}, day: ${dayOfWeek}`);

  try {
    const result = await apiCall('/api/bot/users');
    if (!result.success || !result.data) return;

    for (const user of result.data) {
      const telegramId = user.telegram_id;
      if (!telegramId) continue;

      const settings = await getUserSettings(telegramId);
      if (!settings) continue;

      // ---- Morning daily reminder ----
      if (settings.dailyReminder && settings.morningTime === currentTime) {
        const key = `${telegramId}:morning:${today}`;
        if (!sentReminders.has(key)) {
          sentReminders.set(key, true);
          await sendMorningReminder(telegramId);
        }
      }

      // ---- Evening check-in ----
      if (settings.eveningCheckin && settings.eveningTime === currentTime) {
        const key = `${telegramId}:evening:${today}`;
        if (!sentReminders.has(key)) {
          sentReminders.set(key, true);
          await sendEveningReminder(telegramId);
        }
      }

      // ---- Countdown alerts (daily at 09:00) ----
      if (settings.countdownAlerts && currentTime === '09:00') {
        const key = `${telegramId}:countdown:${today}`;
        if (!sentReminders.has(key)) {
          sentReminders.set(key, true);
          await sendCountdownAlert(telegramId);
        }
      }

      // ---- Weekly summary (Sundays at 10:00) ----
      if (settings.weeklySummary && dayOfWeek === 0 && currentTime === '10:00') {
        const key = `${telegramId}:weekly:${today}`;
        if (!sentReminders.has(key)) {
          sentReminders.set(key, true);
          await sendWeeklySummary(telegramId);
        }
      }

      // ---- Missed alerts (daily at 23:00) ----
      if (settings.missedAlerts && currentTime === '23:00') {
        const key = `${telegramId}:missed:${today}`;
        if (!sentReminders.has(key)) {
          sentReminders.set(key, true);
          await sendMissedAlert(telegramId);
        }
      }
    }

    // Clean up old sent reminders (keep only today's)
    for (const k of sentReminders.keys()) {
      if (!k.endsWith(today)) sentReminders.delete(k);
    }
  } catch (e) {
    logError('runReminderScheduler', e);
  }
}

async function sendMorningReminder(telegramId) {
  const result = await apiCall(`/api/bot/today/${telegramId}`);
  if (!result.success || !result.data || !result.data.topic) return;
  const { topic, videos, files, hours, day, totalDays } = result.data;
  const msg =
    `🌅 *Good morning! Time to start studying.*\n\n` +
    `📚 *Today's topic:* ${topic}\n` +
    `🎬 Videos: ${videos}\n` +
    `📁 Practice files: ${files}\n` +
    `⏱️ Estimated time: ~${hours} hours\n` +
    `📅 Day ${day} of ${totalDays || 'your plan'}\n\n` +
    `Let's make today count! 💪`;
  await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
}

async function sendEveningReminder(telegramId) {
  const result = await apiCall(`/api/bot/user/${telegramId}`);
  if (!result.success || !result.data) return;
  const data = result.data;
  const done = data.days?.filter(d => d.status === 'done').length || 0;
  const total = data.days?.length || 1;
  const msg =
    `🌙 *Evening Check-in*\n\n` +
    `Did you complete today's target?\n\n` +
    `📚 *Today's topic:* ${data.todayTopic || '—'}\n` +
    `📊 Progress: ${done}/${total} days done\n` +
    `🔥 Streak: ${data.streak || 0} days\n\n` +
    `Mark it done on the web app to keep your streak alive! 🔥`;
  await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
}

async function sendCountdownAlert(telegramId) {
  const result = await apiCall(`/api/bot/user/${telegramId}`);
  if (!result.success || !result.data || !result.data.examDate) return;
  const data = result.data;
  const exam = parseAppDate(data.examDate);
  const diff = exam - new Date();
  if (diff <= 0) return;
  const days = Math.floor(diff / 86400000);
  const readiness = data.readiness || 0;
  const status = getReadinessStatus(readiness);
  const bar = buildProgressBar(readiness);
  const msg =
    `⏳ *Daily Countdown Update*\n\n` +
    `*${days} days* until your exam!\n\n` +
    `📊 *Readiness:* ${readiness}%\n` +
    `\`${bar}\`\n` +
    `📈 *Status:* ${status}\n\n` +
    (days <= 7 ? `🚨 *Final stretch!* Give it everything!` : `Keep pushing! Every day matters.`);
  await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
}

async function sendWeeklySummary(telegramId) {
  const result = await apiCall(`/api/bot/user/${telegramId}`);
  if (!result.success || !result.data) return;
  const data = result.data;
  const done = data.days?.filter(d => d.status === 'done').length || 0;
  const total = data.days?.length || 1;
  const pct = Math.round((done / total) * 100);
  const bar = buildProgressBar(pct);
  const msg =
    `📊 *Weekly Summary*\n\n` +
    `Here's your week in review:\n\n` +
    `📈 *Completion:* ${done}/${total} days (${pct}%)\n` +
    `🔥 *Current streak:* ${data.streak || 0} days\n` +
    `🏆 *Longest streak:* ${data.longestStreak || 0} days\n` +
    `🏅 *Readiness:* ${data.readiness || 0}%\n` +
    `\`${bar}\`\n\n` +
    (pct >= 70 ? `🌟 *Great progress!* Keep the momentum going!` : `💪 *Keep going!* Consistency is key!`);
  await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
}

async function sendMissedAlert(telegramId) {
  const result = await apiCall(`/api/bot/user/${telegramId}`);
  if (!result.success || !result.data) return;
  const data = result.data;
  const today = getCurrentISTDate();
  const days = data.days || [];
  const todayDay = days.find(d => {
    const dDate = parseAppDate(d.date);
    return dDate.toISOString().split('T')[0] === today;
  });

  if (todayDay && todayDay.status !== 'done' && todayDay.status !== 'progress') {
    const msg =
      `⚠️ *Missed Day Alert*\n\n` +
      `You haven't started today's target yet!\n\n` +
      `📚 *Topic:* ${todayDay.topic}\n` +
      `📅 Day ${todayDay.day}\n\n` +
      `It's not too late — even 30 minutes counts! 💪\n` +
      `Mark it as "in progress" on the web app to stay on track.`;
    await bot.sendMessage(telegramId, msg, { parse_mode: 'Markdown' });
  }
}

// Start the scheduler — runs every 60 seconds
setInterval(runReminderScheduler, 60000);
logInfo('Reminder scheduler started (60s interval).');

// ============================================================
//  COMMAND MENU (setMyCommands)
// ============================================================
async function resetAndSetCommands() {
  try {
    const generalCommands = [
      { command: "start", description: "✅ Start the bot" },
      { command: "help", description: "📚 All commands" },
      { command: "link", description: "🔗 Link your account" },
      { command: "unlink", description: "🔓 Unlink your account" },
      { command: "myid", description: "🆔 Show your user ID" },
      { command: "today", description: "📅 Today's target" },
      { command: "status", description: "📊 Your progress" },
      { command: "streak", description: "🔥 Your streak" },
      { command: "countdown", description: "⏳ Exam countdown" },
      { command: "analytics", description: "📈 Detailed stats" },
      { command: "leaderboard", description: "🏆 Top users" },
      { command: "us", description: "🔔 Notification settings" },
      { command: "settime", description: "🕐 Set reminder times" },
      { command: "support", description: "🛟 Help & feature guide" },
    ];
    const adminExtra = [
      { command: "admin_panel", description: "⚡ Admin dashboard" },
      { command: "broadcast", description: "📢 Broadcast message" },
      { command: "log", description: "📋 View error logs" },
      { command: "restart", description: "🔄 Restart bot polling" },
    ];
    const adminCommands = generalCommands.concat(adminExtra);

    await axios.post(`https://api.telegram.org/bot${config.token}/setMyCommands`, {
      commands: generalCommands,
      scope: { type: "default" },
      language_code: "en"
    });

    for (const adminId of config.adminIds) {
      await axios.post(`https://api.telegram.org/bot${config.token}/setMyCommands`, {
        commands: adminCommands,
        scope: { type: "chat", chat_id: adminId },
        language_code: "en"
      });
    }
    logInfo('Bot commands updated successfully.');
  } catch (e) {
    logError('resetAndSetCommands', e);
  }
}

// ============================================================
//  STARTUP HEALTH CHECKS
// ============================================================
async function startup() {
  logInfo('Starting Quant Tracker Bot V3 (Supabase backend)...');

  try {
    await axios.get(`${config.apiUrl}/api/health`);
    logInfo('API connection OK.');
  } catch (e) {
    logError('API health check', e);
  }

  try {
    await axios.get(`${config.apiUrl}/api/db-health`);
    logInfo('Database connection OK.');
  } catch (e) {
    logError('Database health check', e);
  }

  await resetAndSetCommands();

  const ownerMsg =
    `🤖 *Quant Tracker V3 is Live!*\n\n` +
    `🕒 Uptime: ${process.uptime()}s\n` +
    `📦 Node: ${process.version}\n` +
    `💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n` +
    `🗄️ Backend: Supabase (PostgreSQL)`;
  for (const id of config.adminIds) {
    try {
      await bot.sendMessage(id, ownerMsg, { parse_mode: 'Markdown' });
    } catch (e) {
      logError(`Notify owner ${id}`, e);
    }
  }
  logInfo('Startup complete.');
}

startup();

process.on('SIGINT', () => {
  logInfo('Shutting down...');
  bot.stopPolling();
  process.exit(0);
});

logInfo('Bot is running.');
