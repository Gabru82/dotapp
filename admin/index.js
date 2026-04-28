document.addEventListener('DOMContentLoaded', () => {
    // Auto-login: If a token and login flag exist, redirect to dashboard
    if (localStorage.getItem('admin_token') && localStorage.getItem('admin_isLoggedIn') === 'true') {
        window.location.href = '/admin/admin.html';
        return;
    }

    document.getElementById('login-btn').addEventListener('click', login);
});

async function login() {
    const id = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!id || !password) {
        return await showAlert('Please fill ID and password');
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, password })
        });

        const data = await response.json();

        if (response.ok && data.token) {
            localStorage.setItem('admin_token', data.token);
            localStorage.setItem('admin_user', JSON.stringify(data.user));
            localStorage.setItem('admin_isLoggedIn', 'true');
            window.location.href = '/admin/admin.html';
        } else {
            showAlert(data.error || 'Login failed');
        }
    } catch (err) {
        showAlert('Server error: ' + err.message);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:12px 24px;border-radius:8px;z-index:10001;box-shadow:0 5px 15px rgba(0,0,0,0.3);font-family:sans-serif;pointer-events:none;transition:opacity 0.3s;opacity:1;";
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 1000);
}

function showAlert(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";
        
        const box = document.createElement('div');
        box.style.cssText = "background:white;color:#333;padding:1.5rem;border-radius:12px;text-align:center;min-width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.2);font-family:sans-serif;";
        box.innerHTML = `
            <p style="margin-bottom:1.5rem;font-size:1rem;font-weight:500;line-height:1.4;">${message}</p>
            <div style="display:flex;gap:1rem;justify-content:center;">
                <button id="alert-cancel" style="background:#6c757d;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Cancel</button>
                <button id="alert-confirm" style="background:#007bff;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Confirm</button>
            </div>
        `;
        box.querySelector('#alert-cancel').onclick = () => { overlay.remove(); resolve(false); };
        box.querySelector('#alert-confirm').onclick = () => { overlay.remove(); resolve(true); };
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    });
}
