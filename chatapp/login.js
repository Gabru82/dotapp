document.addEventListener('DOMContentLoaded', () => {
    // If already logged in, skip the login page
    if (localStorage.getItem('chat_token') && localStorage.getItem('chat_isLoggedIn') === 'true') {
        window.location.href = 'home.html';
        return;
    }

    const loginBtn = document.getElementById('login-btn');
    const idInput = document.getElementById('user-id');
    const passInput = document.getElementById('password');
    const errorDiv = document.getElementById('error-msg');

    const showError = (msg) => {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
    };

    loginBtn.addEventListener('click', async () => {
        const id = idInput.value.trim();
        const password = passInput.value;

        if (!id || !password) {
            return showError('Please fill in both fields');
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, password })
            });

            const data = await response.json();

            if (response.ok && data.token) {
                // Save session data
                localStorage.setItem('chat_token', data.token);
                localStorage.setItem('chat_user', JSON.stringify(data.user));
                localStorage.setItem('chat_isLoggedIn', 'true');
                window.location.href = 'home.html';
            } else {
                showError(data.error || 'Invalid User ID or Password');
            }
        } catch (err) {
            showError('Server error. Please try again later.');
        }
    });

    [idInput, passInput].forEach(el => {
        el.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginBtn.click(); });
    });
});