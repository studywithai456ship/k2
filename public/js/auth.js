//  AUTH WITH TELEGRAM OTP
// ============================================================
const authOverlay = document.getElementById('authOverlay');
const authError = document.getElementById('authError');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authSubmit = document.getElementById('authSubmit');
const authSwitchText = document.getElementById('authSwitchText');
const authSwitchLink = document.getElementById('authSwitchLink');
const guestLink = document.getElementById('guestModeLink');
const authHeaderBtn = document.getElementById('authHeaderBtn');
const logoutHeaderBtn = document.getElementById('logoutHeaderBtn');
const userStatus = document.getElementById('userStatus');

const regState = { telegramId: '', otpVerified: false, resendCountdown: 60, resendTimer: null };
const loginOtpState = { telegramId: '', resendCountdown: 60, resendTimer: null };
let isLogin = true;

async function authApi(endpoint, method = 'GET', data = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (jwtToken) headers.Authorization = `Bearer ${jwtToken}`;
    const options = { method, headers };
    if (data) options.body = JSON.stringify(data);

    const res = await fetch(endpoint, options);
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || result.message || 'Request failed');
    return result;
}

function setStatus(el, message, type = 'info') {
    if (!el) return;
    const colors = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--text-secondary)' };
    el.textContent = message;
    el.style.color = colors[type] || colors.info;
}

function setAuthSession(token, user) {
    jwtToken = token;
    currentUser = user;
    isGuest = false;
    localStorage.setItem('jwt', token);
    localStorage.setItem('user', JSON.stringify(user));
    authOverlay.classList.remove('show');
    updateAuthUI();
    if (typeof updateNavUserInfo === 'function') updateNavUserInfo();
}

function getTelegramPayload(identifier) {
    const value = identifier.trim();
    if (/^\d+$/.test(value)) return { telegramId: Number(value) };
    return null;
}

async function finishLogin(result, fallbackName = 'User') {
    setAuthSession(result.token, result.user || { username: fallbackName });
    await loadFromCloud();
    renderAll();
}

function setAuthMode(login) {
    isLogin = login;
    document.querySelectorAll('.auth-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.authTab === (login ? 'login' : 'register'));
    });
    document.getElementById('loginForm').style.display = login ? 'block' : 'none';
    document.getElementById('registerForm').style.display = login ? 'none' : 'block';
    authSwitchText.textContent = login ? "Don't have an account?" : 'Already have an account?';
    authSwitchLink.textContent = login ? 'Register' : 'Login';
    setStatus(authError, '');
}

function goToStep(step) {
    document.querySelectorAll('#registerForm .step-content').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.step) === step);
    });
}

function getOtp(inputs) {
    return Array.from(inputs).map((i) => i.value).join('');
}

function wireOtpInputs(inputs) {
    inputs.forEach((input, idx) => {
        input.addEventListener('input', function() {
            this.value = this.value.replace(/\D/g, '').slice(0, 1);
            this.classList.toggle('filled', this.value.length === 1);
            if (this.value && idx < inputs.length - 1) inputs[idx + 1].focus();
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace' && !this.value && idx > 0) {
                inputs[idx - 1].value = '';
                inputs[idx - 1].classList.remove('filled');
                inputs[idx - 1].focus();
            }
        });
        input.addEventListener('paste', function(e) {
            e.preventDefault();
            const digits = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, inputs.length);
            inputs.forEach((inp, i) => {
                inp.value = digits[i] || '';
                inp.classList.toggle('filled', Boolean(digits[i]));
            });
            inputs[Math.min(digits.length, inputs.length - 1)]?.focus();
        });
    });
}

function startTimer(stateObj, button, countdownEl) {
    stateObj.resendCountdown = 60;
    button.disabled = true;
    countdownEl.textContent = stateObj.resendCountdown;
    if (stateObj.resendTimer) clearInterval(stateObj.resendTimer);
    stateObj.resendTimer = setInterval(() => {
        stateObj.resendCountdown -= 1;
        countdownEl.textContent = stateObj.resendCountdown;
        if (stateObj.resendCountdown <= 0) {
            clearInterval(stateObj.resendTimer);
            button.disabled = false;
            countdownEl.textContent = '0';
        }
    }, 1000);
}

async function handleAuth() {
    const identifier = authUsername.value.trim();
    const password = authPassword.value.trim();
    if (!identifier || !password) {
        setStatus(authError, 'Please enter username/email and password', 'error');
        return;
    }
    authSubmit.disabled = true;
    setStatus(authError, 'Logging in...', 'info');
    try {
        const payload = identifier.includes('@')
            ? { email: identifier, password }
            : { username: identifier, password };
        const data = await authApi('/api/auth/login', 'POST', payload);
        await finishLogin(data, identifier);
        showToast(`Welcome back, ${identifier}!`, 'success');
    } catch (err) {
        setStatus(authError, err.message, 'error');
    } finally {
        authSubmit.disabled = false;
    }
}

function logout() {
    jwtToken = null;
    currentUser = null;
    isGuest = true;
    localStorage.removeItem('jwt');
    localStorage.removeItem('user');
    state = getDefaultState();
    saveState();
    updateAuthUI();
    if (typeof updateNavUserInfo === 'function') updateNavUserInfo();
    renderAll();
    showToast('Logged out. Using guest mode.', 'info');
}

function updateAuthUI() {
    if (isGuest) {
        userStatus.textContent = 'Guest';
        authHeaderBtn.style.display = 'inline-flex';
        logoutHeaderBtn.style.display = 'none';
        authHeaderBtn.innerHTML = '<i class="fas fa-user"></i> Login';
        authHeaderBtn.onclick = () => { authOverlay.classList.add('show'); setAuthMode(true); };
    } else {
        const name = currentUser?.username || currentUser?.email || currentUser?.telegramId || 'User';
        userStatus.textContent = currentUser?.telegramId ? `${name} · Telegram` : String(name);
        authHeaderBtn.style.display = 'none';
        logoutHeaderBtn.style.display = 'inline-flex';
        logoutHeaderBtn.onclick = logout;
    }
}

function initAuthEvents() {
    document.querySelectorAll('.auth-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => setAuthMode(btn.dataset.authTab === 'login'));
    });
    document.querySelectorAll('.login-method-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.login-method-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.login-method-content').forEach((panel) => {
                panel.classList.toggle('active', panel.dataset.loginPanel === btn.dataset.loginMethod);
            });
        });
    });
    authSwitchLink.addEventListener('click', (e) => {
        e.preventDefault();
        setAuthMode(!isLogin);
    });
    authSubmit.addEventListener('click', handleAuth);
    authPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuth(); });
    guestLink.addEventListener('click', () => {
        authOverlay.classList.remove('show');
        isGuest = true;
        loadState();
        updateAuthUI();
        renderAll();
        showToast('Using guest mode (local storage)', 'info');
    });

    initRegisterEvents();
    initTelegramLoginEvents();
    initForgotPassword();
}

function initRegisterEvents() {
    const regTelegramIdInput = document.getElementById('regTelegramIdInput');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpStatus = document.getElementById('otpStatus');
    const otpInputs = document.querySelectorAll('.otp-input');
    const verifyOtpBtn = document.getElementById('verifyOtpBtn');
    const otpVerifyStatus = document.getElementById('otpVerifyStatus');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const resendCountdown = document.getElementById('resendCountdown');
    const usernameInput = document.getElementById('usernameInput');
    const emailInput = document.getElementById('emailInput');
    const passwordInput = document.getElementById('passwordInput');
    const confirmPasswordInput = document.getElementById('confirmPasswordInput');
    const registerBtn = document.getElementById('registerBtn');
    const registerStatus = document.getElementById('registerStatus');
    const strengthBar = document.getElementById('strengthBar');
    const reqLength = document.getElementById('reqLength');
    const reqUpper = document.getElementById('reqUpper');
    const reqNumber = document.getElementById('reqNumber');

    wireOtpInputs(otpInputs);

    sendOtpBtn.addEventListener('click', async () => {
        const telegramId = regTelegramIdInput.value.trim();
        const telegramPayload = getTelegramPayload(telegramId);
        if (!telegramPayload) {
            setStatus(otpStatus, 'Please enter a valid numeric Telegram User ID', 'error');
            return;
        }
        regState.telegramId = telegramId;
        sendOtpBtn.disabled = true;
        setStatus(otpStatus, 'Sending OTP...', 'info');
        try {
            await authApi('/api/otp/send', 'POST', { ...telegramPayload, action: 'register' });
            setStatus(otpStatus, 'OTP sent to your Telegram.', 'success');
            goToStep(2);
            startTimer(regState, resendOtpBtn, resendCountdown);
        } catch (err) {
            setStatus(otpStatus, err.message, 'error');
        } finally {
            sendOtpBtn.disabled = false;
        }
    });

    verifyOtpBtn.addEventListener('click', async () => {
        const otp = getOtp(otpInputs);
        if (otp.length !== 6) {
            setStatus(otpVerifyStatus, 'Please enter all 6 digits', 'error');
            return;
        }
        verifyOtpBtn.disabled = true;
        setStatus(otpVerifyStatus, 'Verifying...', 'info');
        try {
            await authApi('/api/otp/verify', 'POST', { ...getTelegramPayload(regState.telegramId), otp });
            regState.otpVerified = true;
            setStatus(otpVerifyStatus, 'OTP verified. Set your password.', 'success');
            goToStep(3);
        } catch (err) {
            setStatus(otpVerifyStatus, err.message, 'error');
        } finally {
            verifyOtpBtn.disabled = false;
        }
    });

    resendOtpBtn.addEventListener('click', async () => {
        if (!regState.telegramId) return setStatus(otpVerifyStatus, 'Please enter your Telegram ID first', 'error');
        try {
            await authApi('/api/otp/send', 'POST', { ...getTelegramPayload(regState.telegramId), action: 'register' });
            setStatus(otpVerifyStatus, 'OTP resent. Check Telegram.', 'success');
            startTimer(regState, resendOtpBtn, resendCountdown);
        } catch (err) {
            setStatus(otpVerifyStatus, err.message, 'error');
        }
    });

    function checkPasswordStrength(password) {
        const hasLength = password.length >= 8;
        const hasUpper = /[A-Z]/.test(password);
        const hasNumber = /\d/.test(password);
        reqLength.classList.toggle('met', hasLength);
        reqUpper.classList.toggle('met', hasUpper);
        reqNumber.classList.toggle('met', hasNumber);
        const score = [hasLength, hasUpper, hasNumber].filter(Boolean).length;
        strengthBar.className = 'strength-bar';
        if (score === 1) strengthBar.classList.add('weak');
        if (score === 2) strengthBar.classList.add('medium');
        if (score === 3) strengthBar.classList.add('strong');
        return score === 3;
    }

    passwordInput.addEventListener('input', () => checkPasswordStrength(passwordInput.value));
    registerBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!username) return setStatus(registerStatus, 'Please enter a username', 'error');
        if (!email || !email.includes('@')) return setStatus(registerStatus, 'Please enter a valid email', 'error');
        if (!checkPasswordStrength(password)) return setStatus(registerStatus, 'Password does not meet requirements', 'error');
        if (password !== confirmPasswordInput.value) return setStatus(registerStatus, 'Passwords do not match', 'error');
        if (!regState.otpVerified) return setStatus(registerStatus, 'Please verify Telegram OTP first', 'error');

        registerBtn.disabled = true;
        setStatus(registerStatus, 'Creating account...', 'info');
        try {
            const data = await authApi('/api/auth/register', 'POST', {
                username,
                email,
                password,
                ...getTelegramPayload(regState.telegramId)
            });
            await finishLogin(data, username);
            showToast('Registration successful!', 'success');
        } catch (err) {
            setStatus(registerStatus, err.message, 'error');
        } finally {
            registerBtn.disabled = false;
        }
    });
}

function initTelegramLoginEvents() {
    const loginTelegramIdInput = document.getElementById('loginTelegramIdInput');
    const loginSendOtpBtn = document.getElementById('loginSendOtpBtn');
    const loginOtpInputs = document.querySelectorAll('.login-otp-input');
    const loginVerifyOtpBtn = document.getElementById('loginVerifyOtpBtn');
    const loginOtpStatus = document.getElementById('loginOtpStatus');
    const loginResendOtpBtn = document.getElementById('loginResendOtpBtn');
    const loginResendCountdown = document.getElementById('loginResendCountdown');

    wireOtpInputs(loginOtpInputs);

    loginSendOtpBtn.addEventListener('click', async () => {
        const telegramId = loginTelegramIdInput.value.trim();
        const telegramPayload = getTelegramPayload(telegramId);
        if (!telegramPayload) return setStatus(loginOtpStatus, 'Please enter a valid numeric Telegram User ID', 'error');
        loginOtpState.telegramId = telegramId;
        loginSendOtpBtn.disabled = true;
        setStatus(loginOtpStatus, 'Sending OTP...', 'info');
        try {
            await authApi('/api/otp/send', 'POST', { ...telegramPayload, action: 'login' });
            setStatus(loginOtpStatus, 'OTP sent to your Telegram.', 'success');
            startTimer(loginOtpState, loginResendOtpBtn, loginResendCountdown);
        } catch (err) {
            setStatus(loginOtpStatus, err.message, 'error');
        } finally {
            loginSendOtpBtn.disabled = false;
        }
    });

    loginVerifyOtpBtn.addEventListener('click', async () => {
        const otp = getOtp(loginOtpInputs);
        if (otp.length !== 6) return setStatus(loginOtpStatus, 'Please enter all 6 digits', 'error');
        loginVerifyOtpBtn.disabled = true;
        setStatus(loginOtpStatus, 'Verifying...', 'info');
        try {
            const telegramPayload = getTelegramPayload(loginOtpState.telegramId);
            await authApi('/api/otp/verify', 'POST', { ...telegramPayload, otp });
            const data = await authApi('/api/auth/login-telegram', 'POST', telegramPayload);
            await finishLogin(data, loginOtpState.telegramId);
            showToast('Welcome back!', 'success');
        } catch (err) {
            setStatus(loginOtpStatus, err.message, 'error');
        } finally {
            loginVerifyOtpBtn.disabled = false;
        }
    });

    loginResendOtpBtn.addEventListener('click', async () => {
        if (!loginOtpState.telegramId) return setStatus(loginOtpStatus, 'Please enter your Telegram ID first', 'error');
        try {
            await authApi('/api/otp/send', 'POST', { ...getTelegramPayload(loginOtpState.telegramId), action: 'login' });
            setStatus(loginOtpStatus, 'OTP resent. Check Telegram.', 'success');
            startTimer(loginOtpState, loginResendOtpBtn, loginResendCountdown);
        } catch (err) {
            setStatus(loginOtpStatus, err.message, 'error');
        }
    });
}

function initForgotPassword() {
    document.getElementById('forgotPasswordLink').addEventListener('click', () => {
        openModal('Reset Password', `
            <label for="resetTelegramId">Telegram User ID</label>
            <input type="text" id="resetTelegramId" placeholder="Enter numeric Telegram ID" />
            <button class="btn-primary" id="sendResetOtpBtn" style="width:100%; margin-top:8px;">Send Reset OTP</button>
            <div id="resetStatus" style="margin-top:8px; font-size:0.85rem;"></div>
            <label for="resetOtpInput">OTP Code</label>
            <input type="text" id="resetOtpInput" placeholder="6-digit OTP" maxlength="6" />
            <label for="resetNewPassword">New Password</label>
            <input type="password" id="resetNewPassword" placeholder="Enter new password" />
            <button class="btn-primary" id="resetPasswordBtn" style="width:100%; margin-top:8px;">Reset Password</button>
        `, () => {});
        setTimeout(() => {
            const resetStatus = document.getElementById('resetStatus');
            document.getElementById('sendResetOtpBtn').addEventListener('click', async () => {
                const telegramId = document.getElementById('resetTelegramId').value.trim();
                const telegramPayload = getTelegramPayload(telegramId);
                if (!telegramPayload) return setStatus(resetStatus, 'Please enter a valid numeric Telegram ID', 'error');
                try {
                    await authApi('/api/auth/forgot-password', 'POST', telegramPayload);
                    setStatus(resetStatus, 'OTP sent to your Telegram.', 'success');
                } catch (err) {
                    setStatus(resetStatus, err.message, 'error');
                }
            });
            document.getElementById('resetPasswordBtn').addEventListener('click', async () => {
                const telegramId = document.getElementById('resetTelegramId').value.trim();
                const otp = document.getElementById('resetOtpInput').value.trim();
                const newPassword = document.getElementById('resetNewPassword').value;
                if (!telegramId || !otp || !newPassword) return setStatus(resetStatus, 'Please fill all fields', 'error');
                try {
                    const telegramPayload = getTelegramPayload(telegramId);
                    await authApi('/api/auth/reset-password', 'POST', { ...telegramPayload, otp, newPassword });
                    document.getElementById('modalOverlay').classList.remove('show');
                    showToast('Password reset successful!', 'success');
                } catch (err) {
                    setStatus(resetStatus, err.message, 'error');
                }
            });
        }, 0);
    });
}

function initAuth() {
    initAuthEvents();
    const token = localStorage.getItem('jwt');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (token && user) {
        jwtToken = token;
        currentUser = user;
        isGuest = false;
        authOverlay.classList.remove('show');
        loadFromCloud().then(() => { renderAll(); });
    } else {
        authOverlay.classList.add('show');
        setAuthMode(true);
    }
    updateAuthUI();
}
