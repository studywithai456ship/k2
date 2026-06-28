//  FREE MODE, DEV MODE & LEADERBOARD
// ============================================================
async function fetchSettings() {
try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    freeMode = data.freeMode;
    devMode = data.devMode;
} catch { freeMode = true; devMode = true; }
updateFreeModeUI();
updateDevModeUI();
if (freeMode) fetchLeaderboard();
}

function updateFreeModeUI() {
const badge = document.getElementById('freeBadge');
if (freeMode) {
    badge.textContent = '🆓 FREE';
    badge.style.background = '#10b981';
    document.querySelectorAll('.premium-feature').forEach(el => el.classList.remove('hidden'));
    fetchLeaderboard();
} else {
    badge.textContent = '🔒 PREMIUM';
    badge.style.background = '#ef4444';
    document.querySelectorAll('.premium-feature').forEach(el => el.classList.add('hidden'));
}
}

function updateDevModeUI() {
const devTools = document.getElementById('devTools');
if (!devTools) return;
if (devMode) {
    devTools.classList.remove('hidden');
} else {
    devTools.classList.add('hidden');
}
}

async function fetchLeaderboard() {
try {
    const res = await fetch('/api/leaderboard');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const container = document.getElementById('leaderboardList');
    if (!data.length) {
        container.innerHTML = '<p style="color:var(--text-muted);">No users yet. Be the first!</p>';
        return;
    }
    let html = '<div style="display:grid; grid-template-columns:50px 1fr 60px 60px; gap:6px; font-weight:600; font-size:0.7rem; color:var(--text-muted); padding-bottom:4px; border-bottom:1px solid var(--border-color);">' +
               '<span>#</span><span>User</span><span>Streak</span><span>Done %</span></div>';
    data.forEach(u => {
        html += `<div style="display:grid; grid-template-columns:50px 1fr 60px 60px; gap:6px; padding:4px 0; font-size:0.75rem; color:var(--text-primary); border-bottom:1px solid var(--border-color);">
                    <span>${u.rank}</span>
                    <span>${u.name}</span>
                    <span>🔥 ${u.streak}</span>
                    <span>${u.completion}%</span>
                </div>`;
    });
    container.innerHTML = html;
} catch {
    document.getElementById('leaderboardList').innerHTML = '<p style="color:var(--text-muted);">Failed to load leaderboard</p>';
}
}

// ============================================================
//  STREAK LOGIC
// ============================================================
function updateStreak() {
const today = formatDate(new Date());
const todayIdx = state.days.findIndex(d => d.date === today);
const todayDone = todayIdx >= 0 && state.days[todayIdx].status === 'done';
const yesterday = formatDate(addDays(new Date(), -1));
const last = state.lastStudyDate;

if (todayDone) {
    if (last === today) {
        // already counted
    } else if (last === yesterday || !last) {
        state.streak += 1;
    } else {
        state.streak = 1;
    }
    if (state.streak > state.longestStreak) state.longestStreak = state.streak;
    state.lastStudyDate = today;
} else {
    const yesterdayIdx = state.days.findIndex(d => d.date === yesterday);
    const yesterdayDone = yesterdayIdx >= 0 && state.days[yesterdayIdx].status === 'done';
    if (!yesterdayDone && last && last !== today) {
        state.streak = 0;
    }
}
saveState();
}

// ============================================================
//  ACHIEVEMENTS CHECK
// ============================================================
function checkAchievements() {
const done = state.days.filter(d => d.status === 'done');
const doneCount = done.length;
const totalVids = state.days.reduce((s, d) => s + (d.status === 'done' ? d.videos : 0), 0);
const totalFiles = state.days.reduce((s, d) => s + (d.status === 'done' ? d.files : 0), 0);
const mocks = state.days.filter(d => d.status === 'done' && d.topic.toLowerCase().includes('mock')).length;

const arithTopics = state.days.filter(d => d.phase === 1 || d.phase === 3);
const arithDone = arithTopics.filter(d => d.status === 'done').length;
const diTopics = state.days.filter(d => d.phase === 2);
const diDone = diTopics.filter(d => d.status === 'done').length;

const unlock = (id) => {
    const ach = state.achievements.find(a => a.id === id);
    if (ach && !ach.unlocked) {
        ach.unlocked = true;
        ach.unlockedDate = formatDate(new Date());
    }
};

if (doneCount >= 1) unlock('first_done');
if (state.streak >= 7) unlock('streak_7');
if (state.streak >= 30) unlock('streak_30');
if (arithTopics.length > 0 && (arithDone / arithTopics.length) >= 0.8) unlock('arithmetic_master');
if (diTopics.length > 0 && (diDone / diTopics.length) >= 0.8) unlock('di_master');
if (totalFiles >= 100) unlock('files_100');
if (totalVids >= 50) unlock('videos_50');
if (mocks >= 10) unlock('mock_warrior');

saveState();
}

// ============================================================
//  EXAM READINESS SCORE
// ============================================================
function calculateReadiness() {
const done = state.days.filter(d => d.status === 'done').length;
const total = state.days.length;
const completionPct = total > 0 ? (done / total) * 100 : 0;

const scores = state.days.filter(d => d.score && d.status === 'done').map(d => parseInt(d.score) || 0);
const avgAcc = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

let streakFactor = 0;
if (state.streak >= 30) streakFactor = 100;
else if (state.streak >= 14) streakFactor = 80;
else if (state.streak >= 7) streakFactor = 60;
else if (state.streak >= 3) streakFactor = 40;
else if (state.streak > 0) streakFactor = 20;

const exam = new Date(state.examDate);
const now = new Date();
const daysLeft = daysBetween(formatDate(now), state.examDate);
let daysFactor = 100;
if (daysLeft < 0) daysFactor = 100;
else if (daysLeft < 7) daysFactor = 50;
else if (daysLeft < 15) daysFactor = 70;
else if (daysLeft < 30) daysFactor = 85;

const readiness = (completionPct * 0.4) + (avgAcc * 0.3) + (streakFactor * 0.2) + (daysFactor * 0.1);
return Math.min(100, Math.round(readiness));
}

// ============================================================
//  SMART INSIGHT
// ============================================================

function getInsightMessages() {
const done = state.days.filter(d => d.status === 'done').length;
const total = state.days.length;
const pct = Math.round((done / total) * 100);

const messages = [];
if (pct < 30) messages.push('🚀 Focus on building momentum — complete at least one task daily.');
else if (pct < 60) messages.push('💪 You\'re past the halfway mark! Keep pushing through.');
else if (pct < 85) messages.push('🌟 Almost there! Finish strong by tackling weak areas.');
else messages.push('🎯 Final stretch! Review and practice mocks to seal the deal.');

if (state.streak >= 7) messages.push(`🔥 ${state.streak}-day streak — keep the fire burning!`);
else if (state.streak > 0) messages.push(`📈 ${state.streak}-day streak going — don't break it!`);

const readiness = calculateReadiness();
if (readiness >= 80) messages.push('🏆 Readiness: You\'re ready to ace this!');
else if (readiness >= 60) messages.push('💪 Readiness: Well on track, keep it up!');
else if (readiness >= 40) messages.push('📈 Readiness: Building momentum, stay consistent!');

return messages;
}

function updateInsight() {
const el = document.getElementById('smartInsight');
if (!el) return;
const messages = getInsightMessages();
if (messages.length === 0) {
    el.innerHTML = 'Keep going! You\'re making progress.';
    return;
}
el.innerHTML = messages.join('<br><br>');
}

// ============================================================
//  NOTIFICATION HELPER (Telegram)
// ============================================================
async function notifyStatusChange(dayId, status) {
if (!jwtToken) return;
try {
    const res = await fetch('/api/telegram/notify-status', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ dayId, status })
    });
    const data = await res.json();
    if (data.success) console.log('📨 Telegram notification sent');
    else if (data.message === 'Telegram not linked') console.log('ℹ️ User has not linked Telegram account');
    else console.warn('⚠️ Notification failed:', data.message);
} catch (e) { console.warn('⚠️ Could not send notification:', e.message); }
}

// ============================================================
//  RENDER FUNCTIONS
// ============================================================
function getDayIndexById(dayId) {
const numericId = Number(dayId);
return state.days.findIndex(d => Number(d.id) === numericId);
}

function getValidScore(value) {
const trimmed = String(value).trim();
if (trimmed === '') return '';
if (!/^\d{1,3}$/.test(trimmed)) return null;
const score = Number(trimmed);
if (score < 0 || score > 100) return null;
return String(score);
}

function renderMission() {
const today = formatDate(new Date());
let idx = state.days.findIndex(d => d.date === today);
if (idx < 0) {
    idx = state.days.findIndex(d => d.status !== 'done');
    if (idx < 0) idx = state.days.length - 1;
}
const d = state.days[idx] || state.days[0];
document.getElementById('missionDay').textContent = d.day;
document.getElementById('missionTopic').textContent = d.topic;
document.getElementById('missionVids').textContent = d.videos || 0;
document.getElementById('missionFiles').textContent = d.files || 0;
const hrs = (d.videos * 0.75 + d.files * 0.5).toFixed(1);
document.getElementById('missionTime').textContent = hrs + 'h';
document.getElementById('startStudyBtn').onclick = () => {
    const idx2 = state.days.findIndex(dd => dd.date === today);
    if (idx2 >= 0 && state.days[idx2].status === 'todo') {
        state.days[idx2].status = 'progress';
        saveState();
        renderAll();
        showToast('Mission started! 🔥', 'success');
        notifyStatusChange(state.days[idx2].id, 'progress');
    } else {
        showToast('Today\'s task is already in progress or done ✅', 'info');
    }
};
}

function renderCountdown() {
const exam = new Date(state.examDate);
const now = new Date();
const diff = exam.getTime() - now.getTime();
if (diff <= 0) {
    document.getElementById('cdDays').textContent = '0';
    document.getElementById('cdHours').textContent = '0';
    document.getElementById('cdMins').textContent = '0';
    document.getElementById('cdSecs').textContent = '0';
    document.getElementById('countdownLabel').textContent = 'Exam Passed 🎯';
    return;
}
const days = Math.floor(diff / 86400000);
const hours = Math.floor((diff % 86400000) / 3600000);
const mins = Math.floor((diff % 3600000) / 60000);
const secs = Math.floor((diff % 60000) / 1000);
document.getElementById('cdDays').textContent = days;
document.getElementById('cdHours').textContent = String(hours).padStart(2, '0');
document.getElementById('cdMins').textContent = String(mins).padStart(2, '0');
document.getElementById('cdSecs').textContent = String(secs).padStart(2, '0');
document.getElementById('countdownLabel').textContent = state.examName || 'Countdown';
}

function renderStreak() {
document.getElementById('currentStreak').textContent = state.streak;
document.getElementById('longestStreak').textContent = state.longestStreak;
}

function renderReadiness() {
const score = calculateReadiness();
document.getElementById('readinessScore').textContent = score + '%';
let label = 'Keep pushing!';
if (score >= 80) label = 'Ready to Ace! 🚀';
else if (score >= 60) label = 'Well on track! 💪';
else if (score >= 40) label = 'Building momentum! 📈';
document.getElementById('readinessLabel').textContent = label;
}

function renderRing() {
const done = state.days.filter(d => d.status === 'done').length;
const total = state.days.length;
const pct = total > 0 ? Math.round((done / total) * 100) : 0;
const circumference = 2 * Math.PI * 32;
const offset = circumference - (pct / 100) * circumference;
document.getElementById('ringFg').setAttribute('stroke-dasharray', `${circumference - offset} ${circumference}`);
document.getElementById('ringPct').textContent = pct + '%';
}

function renderStats() {
const done = state.days.filter(d => d.status === 'done').length;
const total = state.days.length;
const pending = total - done;
const vids = state.days.reduce((s, d) => s + (d.status === 'done' ? d.videos : 0), 0);
const files = state.days.reduce((s, d) => s + (d.status === 'done' ? d.files : 0), 0);
const exam = new Date(state.examDate);
const now = new Date();
const daysLeft = Math.max(0, daysBetween(formatDate(now), state.examDate));

document.getElementById('smDone').textContent = done;
document.getElementById('smTotal').textContent = total;
document.getElementById('smPending').textContent = pending;
document.getElementById('smVids').textContent = vids;
document.getElementById('smFiles').textContent = files;
document.getElementById('smDaysLeft').textContent = daysLeft;
document.getElementById('headerDays').textContent = total + 'd';
document.getElementById('footerDate').textContent = state.startDate;
}

function renderAchievements() {
const grid = document.getElementById('achieveGrid');
grid.innerHTML = '';
state.achievements.forEach(a => {
    const card = document.createElement('div');
    card.className = `achieve-card ${a.unlocked ? 'unlocked' : ''}`;
    card.innerHTML = `
        <div class="ach-icon">${a.icon}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.unlocked ? '✅ ' + (a.unlockedDate || 'Done') : a.desc}</div>
    `;
    grid.appendChild(card);
});
}

function renderSubjectGrid() {
const phases = {};
state.days.forEach(d => {
    const p = d.phase || 1;
    if (!phases[p]) phases[p] = { total: 0, done: 0 };
    phases[p].total++;
    if (d.status === 'done') phases[p].done++;
});
const grid = document.getElementById('subjectGrid');
grid.innerHTML = '';
Object.keys(phases).forEach(p => {
    const ph = phases[p];
    const pct = Math.round((ph.done / ph.total) * 100);
    const name = PHASE_NAMES[parseInt(p)] || 'Phase ' + p;
    const color = PHASE_COLORS[parseInt(p) - 1] || '#2a7fcf';
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
        <div class="subj-name"><span>${name}</span><span>${ph.done}/${ph.total}</span></div>
        <div class="subj-bar"><span style="width:${pct}%;background:${color};"></span></div>
        <div class="subj-pct">${pct}%</div>
    `;
    grid.appendChild(card);
});
}

// ============================================================
//  SUBJECT SELECTOR + PIN LOGIC
// ============================================================
const SUBJECTS = ['Quant', 'Reasoning', 'English', 'General Studies'];

function renderPinnedSubjects() {
    const container = document.getElementById('pinnedSubjects');
    if (!container) return;
    container.innerHTML = '';
    const pinned = state.pinnedSubjects || [];
    pinned.forEach(subject => {
        const chip = document.createElement('div');
        chip.className = 'pinned-chip';
        chip.innerHTML = `
            <i class="fas fa-thumbtack pin-icon"></i>
            <span>${subject}</span>
            <i class="fas fa-times pin-remove" data-subject="${subject}"></i>
        `;
        chip.querySelector('.pin-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            unpinSubject(subject);
        });
        chip.querySelector('.pin-icon').addEventListener('click', () => openVideoTracker(subject));
        container.appendChild(chip);
    });
}

function pinSubject(subject) {
    if (!state.pinnedSubjects) state.pinnedSubjects = [];
    if (!state.pinnedSubjects.includes(subject)) {
        state.pinnedSubjects.push(subject);
        saveState();
        renderPinnedSubjects();
        showToast(`${subject} pinned! 📌`, 'success');
    }
}

function unpinSubject(subject) {
    if (!state.pinnedSubjects) return;
    state.pinnedSubjects = state.pinnedSubjects.filter(s => s !== subject);
    saveState();
    renderPinnedSubjects();
    showToast(`${subject} unpinned`, 'info');
}

function initSubjectSelector() {
    const buttons = document.querySelectorAll('.subject-btn');
    buttons.forEach(btn => {
        const subject = btn.dataset.subject;
        if (subject && state.pinnedSubjects && state.pinnedSubjects.includes(subject)) {
            btn.classList.add('active');
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (subject) {
                if (btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    unpinSubject(subject);
                } else {
                    btn.classList.add('active');
                    pinSubject(subject);
                }
            }
        });
    });

    const addCustomBtn = document.getElementById('addCustomSubjectBtn');
    if (addCustomBtn) {
        addCustomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openModal('Add Custom Subject', `
                <label for="customSubjectInput">Subject Name</label>
                <input type="text" id="customSubjectInput" placeholder="e.g. Computer Awareness" />
            `, () => {
                const name = document.getElementById('customSubjectInput').value.trim();
                if (!name) { showToast('Please enter a subject name', 'error'); return; }
                pinSubject(name);
            });
        });
    }
}

// ============================================================
//  VIDEO TRACKER MODAL
// ============================================================
function openVideoTracker(subject) {
    if (!state.customVideos) state.customVideos = {};
    if (!state.customVideos[subject]) state.customVideos[subject] = [];

    renderVideoTrackerModal(subject);
}

function renderVideoTrackerModal(subject) {
    const videos = state.customVideos[subject] || [];

    let videosHtml = '';
    if (videos.length === 0) {
        videosHtml = '<div class="vt-empty">No videos tracked yet. Click "Add Video" to start.</div>';
    } else {
        videosHtml = videos.map((v, i) => `
            <div class="vt-video-row">
                <div class="vt-video-row-header">
                    <span class="vt-video-row-title">Video ${i + 1}</span>
                    <button class="vt-video-delete" data-idx="${i}" title="Delete"><i class="fas fa-trash-alt"></i></button>
                </div>
                <div class="vt-field-group">
                    <div class="vt-field">
                        <label>Video Title</label>
                        <input type="text" data-field="title" data-idx="${i}" value="${v.title || ''}" placeholder="e.g. Number System Basics" />
                    </div>
                    <div class="vt-field">
                        <label>Duration (min)</label>
                        <input type="number" data-field="duration" data-idx="${i}" value="${v.duration || ''}" placeholder="e.g. 45" min="0" />
                    </div>
                    <div class="vt-field">
                        <label>Mock Test?</label>
                        <select data-field="mockTest" data-idx="${i}">
                            <option value="no" ${v.mockTest !== 'yes' ? 'selected' : ''}>No</option>
                            <option value="yes" ${v.mockTest === 'yes' ? 'selected' : ''}>Yes</option>
                        </select>
                    </div>
                    <div class="vt-field">
                        <label>Revisions</label>
                        <input type="number" data-field="revisions" data-idx="${i}" value="${v.revisions || 0}" placeholder="0" min="0" />
                    </div>
                    <div class="vt-field">
                        <label>Mock Attempts</label>
                        <input type="number" data-field="mockAttempts" data-idx="${i}" value="${v.mockAttempts || 0}" placeholder="0" min="0" />
                    </div>
                </div>
            </div>
        `).join('');
    }

    const totalDuration = videos.reduce((s, v) => s + (parseInt(v.duration) || 0), 0);
    const totalRevisions = videos.reduce((s, v) => s + (parseInt(v.revisions) || 0), 0);
    const totalMocks = videos.reduce((s, v) => s + (parseInt(v.mockAttempts) || 0), 0);

    openModal(`Video Tracker — ${subject}`, `
        <div class="vt-modal-body">
            <div class="vt-subject-title">
                <i class="fas fa-play-circle"></i> ${subject} — ${videos.length} video(s)
            </div>
            <button class="vt-add-btn" id="vtAddBtn"><i class="fas fa-plus"></i> Add Video</button>
            <div id="vtVideosContainer">${videosHtml}</div>
            <div class="vt-stats">
                <div class="vt-stat-item"><span class="vt-stat-value">${videos.length}</span><span>Videos</span></div>
                <div class="vt-stat-item"><span class="vt-stat-value">${totalDuration}</span><span>Total Min</span></div>
                <div class="vt-stat-item"><span class="vt-stat-value">${totalRevisions}</span><span>Revisions</span></div>
                <div class="vt-stat-item"><span class="vt-stat-value">${totalMocks}</span><span>Mocks</span></div>
            </div>
        </div>
    `, () => {
        saveState();
        showToast(`${subject} video data saved! 💾`, 'success');
    });

    const addBtn = document.getElementById('vtAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (!state.customVideos[subject]) state.customVideos[subject] = [];
            state.customVideos[subject].push({
                title: '', duration: '', mockTest: 'no', revisions: 0, mockAttempts: 0
            });
            renderVideoTrackerModal(subject);
        });
    }

    document.querySelectorAll('.vt-video-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            state.customVideos[subject].splice(idx, 1);
            renderVideoTrackerModal(subject);
        });
    });

    document.querySelectorAll('.vt-field input, .vt-field select').forEach(input => {
        input.addEventListener('change', function() {
            const idx = parseInt(this.dataset.idx);
            const field = this.dataset.field;
            if (!state.customVideos[subject][idx]) return;
            state.customVideos[subject][idx][field] = this.value;
        });
    });
}

// ============================================================
//  ACCORDION RENDER (with double-tap / triple-tap on topic)
// ============================================================
function renderAccordion() {
const container = document.getElementById('courseAccordion');
container.innerHTML = '';
const phases = {};
state.days.forEach(d => {
    const p = d.phase || 1;
    if (!phases[p]) phases[p] = [];
    phases[p].push(d);
});

Object.keys(phases).sort((a, b) => parseInt(a) - parseInt(b)).forEach(p => {
    const items = phases[p];
    const done = items.filter(d => d.status === 'done').length;
    const total = items.length;
    const pct = Math.round((done / total) * 100);
    const name = PHASE_NAMES[parseInt(p)] || 'Phase ' + p;
    const color = PHASE_COLORS[parseInt(p) - 1] || '#2a7fcf';

    const header = document.createElement('div');
    header.className = 'phase-header';
    header.innerHTML = `
        <div class="ph-left">
            <i class="fas fa-chevron-right" style="transition:0.2s;"></i>
            <span>${name}</span>
            <span class="ph-badge">${done}/${total}</span>
        </div>
        <div class="ph-right">
            <span>${pct}%</span>
            <span style="display:inline-block; width:60px; height:4px; background:var(--ring-bg); border-radius:10px; overflow:hidden;">
                <span style="display:block; height:100%; width:${pct}%; background:${color}; border-radius:10px;"></span>
            </span>
        </div>
    `;

    const body = document.createElement('div');
    body.className = 'phase-body';

    const colHeader = document.createElement('div');
    colHeader.className = 'col-header';
    colHeader.innerHTML = `
        <span>Day</span>
        <span>Date</span>
        <span>Topic</span>
        <span>📹</span>
        <span>📄</span>
        <span>Status</span>
        <span>Score</span>
        <span></span>
    `;
    body.appendChild(colHeader);

    items.forEach((d) => {
        const row = document.createElement('div');
        row.className = 'day-row';
        const isDone = d.status === 'done';
        const isProgress = d.status === 'progress';
        const isTodo = d.status === 'todo';
        row.innerHTML = `
            <span class="week-badge">${d.day}</span>
            <span class="d-date">${d.date}</span>
            <span class="d-topic" data-idx="${d.id}" title="Double-tap: Shift -1 day | Triple-tap: Shift +1 day">
                ${d.topic}
                <span class="tap-hint-tooltip">Double-tap: -1 day | Triple-tap: +1 day</span>
            </span>
            <span>${d.videos}</span>
            <span>${d.files}</span>
            <span class="d-status">
                <button class="sbtn todo ${isTodo ? 'active' : ''}" data-idx="${d.id}" data-status="todo" title="Todo">⚪</button>
                <button class="sbtn progress ${isProgress ? 'active' : ''}" data-idx="${d.id}" data-status="progress" title="Progress">⏳</button>
                <button class="sbtn done ${isDone ? 'active' : ''}" data-idx="${d.id}" data-status="done" title="Done">✅</button>
            </span>
            <span class="d-score"><input type="number" min="0" max="100" placeholder="%" value="${d.score || ''}" data-idx="${d.id}" /></span>
            <span></span>
        `;
        body.appendChild(row);
    });

    // Status button listeners
    body.querySelectorAll('.sbtn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const dayId = parseInt(this.dataset.idx);
            const idx = getDayIndexById(dayId);
            if (idx < 0) return showToast('Task not found. Please refresh and try again.', 'error');
            const status = this.dataset.status;
            const oldStatus = state.days[idx].status;
            if (oldStatus === status) return;
            state.days[idx].status = status;
            saveState();
            updateStreak();
            checkAchievements();
            renderAll();
            showToast(`Task marked as ${status}`, 'success');
            if (status === 'progress' || status === 'done') {
                notifyStatusChange(state.days[idx].id, status);
            }
        });
    });

    // Score input listeners
    body.querySelectorAll('.d-score input').forEach(inp => {
        inp.addEventListener('change', function() {
            const dayId = parseInt(this.dataset.idx);
            const idx = getDayIndexById(dayId);
            if (idx < 0) return showToast('Task not found. Please refresh and try again.', 'error');
            const score = getValidScore(this.value);
            if (score === null) {
                this.value = state.days[idx].score || '';
                return showToast('Score must be a number from 0 to 100.', 'error');
            }
            state.days[idx].score = score;
            state.days[idx].accuracy = score === '' ? null : Number(score);
            saveState();
            renderReadiness();
            updateInsight();
            showToast(score === '' ? 'Score cleared' : `Score saved: ${score}%`, 'success');
        });
    });

    // Double-tap / triple-tap on topic name
    body.querySelectorAll('.d-topic').forEach(topicEl => {
        let tapCount = 0;
        let tapTimer = null;

        topicEl.addEventListener('click', function(e) {
            e.stopPropagation();

            tapCount++;
            this.classList.add('tap-flash');
            setTimeout(() => this.classList.remove('tap-flash'), 300);

            if (tapCount === 1) {
                tapTimer = setTimeout(() => {
                    tapCount = 0;
                }, 400);
            } else if (tapCount === 2) {
                clearTimeout(tapTimer);
                tapTimer = setTimeout(() => {
                    const dayId = parseInt(this.dataset.idx);
                    const idx = getDayIndexById(dayId);
                    if (idx < 0) return;
                    if (confirm('Shift schedule -1 day? This will pull all future tasks by one day. Are you sure?')) {
                        for (let i = idx; i < state.days.length; i++) {
                            state.days[i].day = Math.max(1, state.days[i].day - 1);
                            state.days[i].date = formatDate(addDays(parseDate(state.days[i].date), -1));
                        }
                        saveState();
                        renderAll();
                        showToast('Schedule shifted -1 day 🔄', 'info');
                    }
                    tapCount = 0;
                }, 400);
            } else if (tapCount === 3) {
                clearTimeout(tapTimer);
                const dayId = parseInt(this.dataset.idx);
                const idx = getDayIndexById(dayId);
                if (idx < 0) return;
                if (confirm('Shift schedule +1 day? This will push all future tasks by one day. Are you sure?')) {
                    for (let i = idx; i < state.days.length; i++) {
                        state.days[i].day += 1;
                        state.days[i].date = formatDate(addDays(parseDate(state.days[i].date), 1));
                    }
                    saveState();
                    renderAll();
                    showToast('Schedule shifted +1 day 🔄', 'info');
                }
                tapCount = 0;
            }
        });
    });

    header.addEventListener('click', function() {
        body.classList.toggle('open');
        const icon = this.querySelector('.ph-left i');
        if (icon) icon.style.transform = body.classList.contains('open') ? 'rotate(90deg)' : 'rotate(0deg)';
    });

    container.appendChild(header);
    container.appendChild(body);

    if (parseInt(p) === 1) {
        body.classList.add('open');
        header.querySelector('.ph-left i').style.transform = 'rotate(90deg)';
    }
});
}

// ============================================================
//  MAIN RENDER
// ============================================================
function renderAll() {
updateStreak();
checkAchievements();
renderMission();
renderCountdown();
renderStreak();
renderReadiness();
renderRing();
renderStats();
renderAchievements();
renderSubjectGrid();
renderAccordion();
renderPinnedSubjects();
applyTheme(getTheme());
updateInsight();
updateFreeModeUI();
updateDevModeUI();
if (freeMode) fetchLeaderboard();
}

// ============================================================
