//  STATE
// ============================================================
let state = null;
let jwtToken = null;
let currentUser = null;
let freeMode = true;
let devMode = true;
let isGuest = true;

function getDefaultState() {
    const start = new Date(2026, 5, 22);
    return {
        days: buildDays(start),
        startDate: formatDate(start),
        examDate: '2026-08-01',
        examName: 'SBI PO',
        theme: 'light',
        streak: 0,
        longestStreak: 0,
        lastStudyDate: null,
        achievements: ACHIEVEMENT_DEFS.map(a => ({ ...a, unlocked: false, unlockedDate: null })),
        heatmap: {},
        scoreHistory: [],
        studySessions: [],
        revisionTracker: {},
        pinnedSubjects: [],
        customVideos: {}
    };
}

function loadState() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.days && parsed.days.length === BASE_TOPICS.length) {
                state = parsed;
                if (!state.examName) state.examName = 'SBI PO';
                if (!state.examDate) state.examDate = '2026-08-01';
                if (!state.theme) state.theme = 'light';
                if (!state.heatmap) state.heatmap = {};
                if (!state.scoreHistory) state.scoreHistory = [];
                if (!state.studySessions) state.studySessions = [];
                if (!state.revisionTracker) state.revisionTracker = {};
                if (!state.pinnedSubjects) state.pinnedSubjects = [];
                if (!state.customVideos) state.customVideos = {};
                if (!state.achievements || state.achievements.length !== ACHIEVEMENT_DEFS.length) {
                    state.achievements = ACHIEVEMENT_DEFS.map(a => {
                        const existing = (state.achievements || []).find(e => e.id === a.id);
                        return existing || { ...a, unlocked: false, unlockedDate: null };
                    });
                }
                if (!state.streak) state.streak = 0;
                if (!state.longestStreak) state.longestStreak = 0;
                return;
            }
        } catch (_) {}
    }
    state = getDefaultState();
    saveState();
}

function normalizeStateShape() {
    if (!state) return;
    if (!state.examName) state.examName = 'SBI PO';
    if (!state.examDate) state.examDate = '2026-08-01';
    if (!state.theme) state.theme = 'light';
    if (!state.heatmap) state.heatmap = {};
    if (!state.scoreHistory) state.scoreHistory = [];
    if (!state.studySessions) state.studySessions = [];
    if (!state.revisionTracker) state.revisionTracker = {};
    if (!state.pinnedSubjects) state.pinnedSubjects = [];
    if (!state.customVideos) state.customVideos = {};
    if (!state.achievements || state.achievements.length !== ACHIEVEMENT_DEFS.length) {
        state.achievements = ACHIEVEMENT_DEFS.map(a => {
            const existing = (state.achievements || []).find(e => e.id === a.id);
            return existing || { ...a, unlocked: false, unlockedDate: null };
        });
    }
    if (!state.streak) state.streak = 0;
    if (!state.longestStreak) state.longestStreak = 0;
    if (Array.isArray(state.days)) {
        state.days.forEach((day, idx) => {
            if (day.id === undefined || day.id === null || day.id === '') day.id = idx;
            if (!day.status) day.status = 'todo';
            if (day.score === undefined || day.score === null) day.score = '';
        });
    }
}

async function loadFromCloud() {
    if (!jwtToken) return;
    const res = await fetch('/api/sync', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    if (!res.ok) throw new Error('Failed to load cloud data');
    const data = await res.json();
    if (data.days && data.days.length === BASE_TOPICS.length) {
        state = {
            ...state,
            examName: data.examName,
            examDate: data.examDate,
            startDate: data.startDate,
            days: data.days,
            streak: data.streak,
            longestStreak: data.longestStreak,
            lastStudyDate: data.lastStudyDate,
            achievements: data.achievements,
            heatmap: data.heatmap,
            scoreHistory: data.scoreHistory,
            studySessions: data.studySessions,
            revisionTracker: data.revisionTracker,
            pinnedSubjects: data.pinnedSubjects || [],
            customVideos: data.customVideos || {}
        };
        normalizeStateShape();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
}

async function syncToCloud() {
    if (!jwtToken || !state) return;
    await fetch('/api/sync', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(state)
    });
}

let syncTimer = null;
function syncToCloudDebounced() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncToCloud().catch(e => console.warn('Cloud sync failed:', e.message));
    }, 600);
}

function saveState() {
    normalizeStateShape();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (jwtToken) syncToCloudDebounced();
}
