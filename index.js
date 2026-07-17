const API_BASE_URL = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:5000/api" 
  : window.location.origin + "/api";

//Only renders when Backend fails to send data
        const DEFAULT_DATA = {
            global: { expectedTotal: 894000, currentFunding: 188847, spent: 94000 },
            divisions: {
                structures: {
                    title: "Structures",
                    expectedCost: 120000,
                    ledger: [
                        { id: "ST-01", date: "2026-06-01", desc: "Chassis tubes", vendor: "Steel Tubes Co.", amount: 50000, status: "PENDING" },
                        { id: "ST-02", date: "2026-06-03", desc: "Bodyworks", vendor: "Fibreglass and Epoxy Supply", amount: 20000, status: "PENDING" },
                        { id: "ST-03", date: "2026-06-05", desc: "Fasteners", vendor: "Misc Hardware", amount: 10000, status: "PENDING" },
                        { id: "ST-04", date: "2026-06-06", desc: "Brake pedals", vendor: "Aluminium Works", amount: 5000, status: "PENDING" },
                        { id: "ST-05", date: "2026-06-07", desc: "TSAC (Structure & Insulation)", vendor: "Steel Sheets & Insulation", amount: 30000, status: "PENDING" },
                        { id: "ST-06", date: "2026-06-08", desc: "Drive-shafts", vendor: "OEM Parts Dealer", amount: 5000, status: "PENDING" }
                    ]
                },
                steering: {
                    title: "Steering & Suspension",
                    expectedCost: 62000,
                    ledger: [
                        { id: "SS-01", date: "2026-06-10", desc: "Steering Rack", vendor: "Custom Machined", amount: 40000, status: "PENDING" },
                        { id: "SS-02", date: "2026-06-12", desc: "Damper Fluid & Seals", vendor: "RaceKit", amount: 22000, status: "PENDING" }
                    ]
                },
                safety: {
                    title: "Safety Electronics",
                    expectedCost: 121000,
                    ledger: [
                        { id: "SA-01", date: "2026-06-14", desc: "Shutdown Buttons", vendor: "Element14", amount: 21000, status: "PENDING" },
                        { id: "SA-02", date: "2026-06-15", desc: "Insulation Monitoring Device", vendor: "Bender", amount: 100000, status: "PENDING" }
                    ]
                },
                battery: {
                    title: "Battery",
                    expectedCost: 387000,
                    ledger: [
                        { id: "BA-01", date: "2026-06-18", desc: "LiFePO4 Cells", vendor: "Lithium Store", amount: 300000, status: "PENDING" },
                        { id: "BA-02", date: "2026-06-19", desc: "BMS Controller Board", vendor: "Orion BMS", amount: 87000, status: "PENDING" }
                    ]
                },
                other: {
                    title: "Other",
                    expectedCost: 204000,
                    ledger: [
                        { id: "OT-01", date: "2026-05-20", desc: "Competition Registration Fee", vendor: "Formula Bharat", amount: 94000, status: "PAID" },
                        { id: "OT-02", date: "2026-06-22", desc: "Team Apparel & Decals", vendor: "Local Print Shop", amount: 110000, status: "PENDING" }
                    ]
                }
            }
        };

        const appState = {
            currentTab: 'overview',
            global: { expectedTotal: 0, currentFunding: 0, spent: 0 },
            divisions: {}
        };

        // Auth state lives only in memory for this session. The backend
        // has no token concept, so we hold onto the password itself and
        // resend it as a header on every write.
        const authState = {
            password: null,
            isAdmin: false
        };

        // Cache of the last fetched commit log entries, so we don't
        // re-fetch every single time the admin flips back to the tab
        // within the same session (a manual refresh button re-fetches).
        let logsCache = null;

        function formatINR(amount) {
            return '₹' + Number(amount || 0).toLocaleString('en-IN');
        }

        function showToast(message, isError) {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'toast' + (isError ? ' error-toast' : '');
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3200);
        }

        /* ---------------------------------------------------------
           DATA FETCHING (open to everyone, no auth header needed)
           --------------------------------------------------------- */
        async function fetchExpenseData() {
            try {
                const res = await fetch(`${API_BASE_URL}/data`, { method: 'GET' });
                if (!res.ok) throw new Error(`Server returned ${res.status}`);
                const data = await res.json();

                // First run / empty GitHub file comes back as {}.
                const isEmpty = !data || Object.keys(data).length === 0 || !data.divisions;
                const source = isEmpty ? DEFAULT_DATA : data;

                appState.global = source.global || DEFAULT_DATA.global;
                appState.divisions = source.divisions || DEFAULT_DATA.divisions;
            } catch (err) {
                console.error('Failed to fetch expense data:', err);
                showToast('Could not load data from server.', true);
                appState.global = DEFAULT_DATA.global;
                appState.divisions = DEFAULT_DATA.divisions;
            }
        }

        // Pushes the ENTIRE current appState (global + divisions) to the
        // backend, which overwrites data.json on GitHub in one commit.
        async function persistFullState(auditMessage = "") {
            const res = await fetch(`${API_BASE_URL}/data`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': authState.password || '',
                    'X-Audit-Message': auditMessage
                },
                body: JSON.stringify({
                    global: appState.global,
                    divisions: appState.divisions
                })
            });
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
        }

        /* ---------------------------------------------------------
           AUTH
           --------------------------------------------------------- */
        async function attemptLogin(password) {
            const res = await fetch(`${API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (!res.ok) {
                throw new Error('Invalid password');
            }

            // Backend just confirms the password is correct; we hold onto
            // it ourselves (in memory + localStorage) to resend as
            // X-Admin-Password on every write, and so the session survives
            // a page refresh.
            authState.password = password;
            authState.isAdmin = true;
            localStorage.setItem('admin_password', password);
        }

        function logoutAdmin() {
            authState.password = null;
            authState.isAdmin = false;
            localStorage.removeItem('admin_password');
            logsCache = null;

            // A non-admin has no business staying on the logs tab —
            // bounce back to overview before re-rendering anything.
            if (appState.currentTab === 'logs') {
                appState.currentTab = 'overview';
            }

            renderAuthZone();
            updateLogsTabVisibility();
            rerenderCurrentView();
            showToast('Logged out.');
        }

        // On page load, if a password was saved from a previous session,
        // re-validate it against the backend (passwords can change /
        // localStorage can be stale) before trusting it.
        async function restoreAdminSession() {
            const savedPassword = localStorage.getItem('admin_password');
            if (!savedPassword) return;

            try {
                await attemptLogin(savedPassword);
            } catch (err) {
                // Saved password no longer valid — clear it quietly.
                localStorage.removeItem('admin_password');
            }
        }

        function renderAuthZone() {
            const zone = document.getElementById('auth-zone');
            if (authState.isAdmin) {
                zone.innerHTML = `
                    <span class="admin-pill"><i class="fa-solid fa-shield-halved"></i> ADMIN</span>
                    <button class="btn-auth logout-variant" onclick="logoutAdmin()">
                        <i class="fa-solid fa-right-from-bracket"></i> Log out
                    </button>
                `;
            } else {
                zone.innerHTML = `
                    <button class="btn-auth" onclick="openLoginModal()">
                        <i class="fa-solid fa-lock"></i> Admin login
                    </button>
                `;
            }
        }

        // Shows the "Logs" nav button only while an admin session is
        // active. Assumes a nav button with id="tab-logs" exists in the
        // markup (hidden by default, e.g. class="hidden" or
        // style="display:none"). Non-admins should never see or be able
        // to reach this tab.
        function updateLogsTabVisibility() {
            const logsBtn = document.getElementById('tab-logs');
            if (!logsBtn) return;
            logsBtn.classList.toggle('hidden', !authState.isAdmin);
            logsBtn.style.display = authState.isAdmin ? '' : 'none';
        }

        function openLoginModal() {
            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.id = 'login-modal-backdrop';
            backdrop.innerHTML = `
                <div class="modal-box">
                    <h3>Admin Login</h3>
                    <input type="password" id="login-passcode-input" placeholder="Enter admin passcode" autofocus />
                    <div class="modal-error" id="login-error-msg">Invalid passcode. Try again.</div>
                    <div class="modal-actions">
                        <button class="btn-modal-cancel" onclick="closeLoginModal()">Cancel</button>
                        <button class="btn-modal-submit" onclick="submitLogin()">Log in</button>
                    </div>
                </div>
            `;
            document.body.appendChild(backdrop);

            const input = document.getElementById('login-passcode-input');
            input.focus();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitLogin();
                if (e.key === 'Escape') closeLoginModal();
            });
        }

        function closeLoginModal() {
            const backdrop = document.getElementById('login-modal-backdrop');
            if (backdrop) backdrop.remove();
        }

        async function submitLogin() {
            const input = document.getElementById('login-passcode-input');
            const errorMsg = document.getElementById('login-error-msg');
            const passcode = input.value.trim();

            if (!passcode) return;

            try {
                await attemptLogin(passcode);
                closeLoginModal();
                renderAuthZone();
                updateLogsTabVisibility();
                rerenderCurrentView();
                showToast('Logged in as admin.');
            } catch (err) {
                console.error('Login failed:', err);
                errorMsg.style.display = 'block';
            }
        }

        /* ---------------------------------------------------------
           NAVIGATION
           --------------------------------------------------------- */
        function switchTab(tabId) {
            // Logs is admin-only real estate. If a non-admin somehow
            // triggers this (stale DOM, direct console call, etc.) just
            // refuse and stay put instead of rendering anything.
            if (tabId === 'logs' && !authState.isAdmin) {
                showToast('Admin login required to view logs.', true);
                return;
            }

            appState.currentTab = tabId;

            document.querySelectorAll('nav button').forEach(btn => {
                btn.classList.remove('nav-tab-active');
            });
            const targetBtn = document.getElementById(`tab-${tabId}`);
            if (targetBtn) targetBtn.classList.add('nav-tab-active');

            rerenderCurrentView();
        }

        function rerenderCurrentView() {
            if (appState.currentTab === 'overview') {
                renderOverview();
            } else if (appState.currentTab === 'logs') {
                // Guard again here too — covers cases where appState.currentTab
                // was left as 'logs' (e.g. stale state) but admin status
                // changed since the last render.
                if (!authState.isAdmin) {
                    appState.currentTab = 'overview';
                    renderOverview();
                    return;
                }
                renderLogsView();
            } else {
                renderDivisionView(appState.currentTab);
            }
        }

        function updateHeaderTotals() {
            document.getElementById('header-expected-total').innerText = formatINR(appState.global.expectedTotal);
            document.getElementById('header-current-funding').innerText = formatINR(appState.global.currentFunding);
        }

        /* ---------------------------------------------------------
           OVERVIEW VIEW
           --------------------------------------------------------- */
        function renderOverview() {
            const container = document.getElementById('view-container');
            const fundsAvailable = appState.global.currentFunding - appState.global.spent;
            const shortfall = appState.global.expectedTotal - appState.global.currentFunding;
            const fundingPercent = appState.global.expectedTotal > 0
                ? Math.round((appState.global.currentFunding / appState.global.expectedTotal) * 100)
                : 0;

            let breakdownHTML = '';
            for (const [key, div] of Object.entries(appState.divisions)) {
                const paidAmt = div.ledger.filter(i => i.status === 'PAID').reduce((sum, i) => sum + i.amount, 0);
                const paidPercent = div.expectedCost > 0 ? Math.round((paidAmt / div.expectedCost) * 100) : 0;

                breakdownHTML += `
                    <div class="breakdown-row">
                        <div class="breakdown-meta-identity">
                            <span class="badge-mono-tag">${key.slice(0,3)}</span>
                            <span style="color: var(--text-primary); font-weight: 500;">${div.title}</span>
                        </div>
                        <div class="breakdown-bar-track">
                            <div class="breakdown-bar-fill" style="width: ${paidPercent}%; background-color: var(--color-${key});"></div>
                        </div>
                        <div class="breakdown-right-pricing">
                            <span style="color: var(--text-primary); font-weight: 600; display: block;">${formatINR(div.expectedCost)}</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">${paidPercent}% paid</span>
                        </div>
                    </div>
                `;
            }

            const editExpectedBtn = authState.isAdmin
                ? `<button class="edit-icon-btn" onclick="openGlobalEditModal('expectedTotal')" title="Edit Expected Total Cost"><i class="fa-solid fa-pen"></i></button>`
                : '';
            const editFundingBtn = authState.isAdmin
                ? `<button class="edit-icon-btn" onclick="openGlobalEditModal('currentFunding')" title="Edit Current Funding"><i class="fa-solid fa-pen"></i></button>`
                : '';
            const editAvailableBtn = authState.isAdmin
                ? `<button class="edit-icon-btn" onclick="openGlobalEditModal('currentFunding')" title="Edit Current Funding (adjusts available funds)"><i class="fa-solid fa-pen"></i></button>`
                : '';

            container.innerHTML = `
                <div class="cards-grid-3">
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Expected Total Cost</span>
                        <h2 class="card-title-macro">${formatINR(appState.global.expectedTotal)}</h2>
                        <span class="card-subtext-muted">Across ${Object.keys(appState.divisions).length} divisions</span>
                        ${editExpectedBtn}
                    </div>
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Current Funding</span>
                        <h2 class="card-title-macro-green">${formatINR(appState.global.currentFunding)}</h2>
                        <span class="card-subtext-muted">${fundingPercent}% of expected cost</span>
                        ${editFundingBtn}
                    </div>
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Funds Available</span>
                        <h2 class="card-title-macro">${formatINR(fundsAvailable)}</h2>
                        <span class="card-subtext-muted">Funding minus paid out (${formatINR(appState.global.spent)} spent)</span>
                        ${editAvailableBtn}
                    </div>
                </div>

                <div class="analytics-grid-2">
                    <div class="dashboard-card chart-center-wrapper">
                        <h3 class="section-heading-tracker">Funding to Expected Cost Ratio</h3>
                        <div class="radial-progress-svg-container">
                            <svg viewBox="0 0 36 36">
                                <path class="svg-circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <path class="svg-circle-fill-green" stroke-dasharray="${fundingPercent}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            </svg>
                            <div class="absolute-radial-center">
                                <span class="radial-core-text">${fundingPercent}%</span>
                                <span class="radial-sub-text">Funded</span>
                            </div>
                        </div>
                        <div class="ratio-split-legend">
                            <div><span class="legend-val-title">Funded</span><span style="color: var(--accent-green); font-weight: 700;">${formatINR(appState.global.currentFunding)}</span></div>
                            <div style="text-align: right;"><span class="legend-val-title">Shortfall</span><span style="color: var(--accent-red); font-weight: 700;">${formatINR(shortfall)}</span></div>
                        </div>
                    </div>

                    <div class="dashboard-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                        <h3 class="section-heading-tracker">Expected Cost Distribution by Division</h3>
                        <div class="mock-donut-container">
                            <div class="mock-segmented-ring">
                                <div class="mock-segmented-inner-cutout"></div>
                            </div>
                        </div>
                        <div class="flex-chart-labels">
                            <span class="pill-indicator-dot"><span class="dot-node" style="background-color: var(--color-structures)"></span>Structures</span>
                            <span class="pill-indicator-dot"><span class="dot-node" style="background-color: var(--color-steering)"></span>Steering & Susp.</span>
                            <span class="pill-indicator-dot"><span class="dot-node" style="background-color: var(--color-safety)"></span>Safety Elec.</span>
                            <span class="pill-indicator-dot"><span class="dot-node" style="background-color: var(--color-battery)"></span>Battery</span>
                            <span class="pill-indicator-dot"><span class="dot-node" style="background-color: var(--color-other)"></span>Other</span>
                        </div>
                    </div>
                </div>

                <div class="dashboard-card">
                    <h3 class="section-heading-tracker">Division Breakdown</h3>
                    <div style="display: flex; flex-direction: column;">${breakdownHTML}</div>
                </div>
            `;
        }

        /* ---------------------------------------------------------
           DIVISION (LEDGER) VIEW
           --------------------------------------------------------- */
        function renderDivisionView(divKey) {
            const container = document.getElementById('view-container');
            const data = appState.divisions[divKey];

            if (!data) {
                container.innerHTML = `<div class="loading-msg">No data for this division.</div>`;
                return;
            }

            const totalExpected = data.expectedCost;
            const spent = data.ledger.filter(i => i.status === 'PAID').reduce((sum, item) => sum + item.amount, 0);
            const pending = data.ledger.filter(i => i.status === 'PENDING').reduce((sum, item) => sum + item.amount, 0);
            const itemCount = data.ledger.length;
            const paidRatio = totalExpected > 0 ? Math.round((spent / totalExpected) * 100) : 0;

            let rowHTML = '';
            if (itemCount === 0) {
                rowHTML = `<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No expenses logged yet for this division.</td></tr>`;
            } else {
                data.ledger.forEach((item) => {
                    const badgeClass = item.status === 'PAID' ? 'paid-type' : 'pending-type';
                    const statusBadge = authState.isAdmin
                        ? `<span class="status-badge ${badgeClass} admin-clickable" onclick="toggleItemStatus('${divKey}', '${item.id}')" title="Click to toggle status">${item.status}</span>`
                        : `<span class="status-badge ${badgeClass}">${item.status}</span>`;

                    const actionsCell = authState.isAdmin
                        ? `<div class="actions-wrapper">
                               <button onclick="promptEditItem('${divKey}', '${item.id}')" class="btn-edit" title="Edit entry"><i class="fa-solid fa-pen text-xs"></i></button>
                               <button onclick="deleteLedgerItem('${divKey}', '${item.id}')" class="btn-trash" title="Delete entry"><i class="fa-solid fa-trash-can text-xs"></i></button>
                           </div>`
                        : `<span class="no-actions">—</span>`;

                    rowHTML += `
                        <tr>
                            <td class="td-id">${item.id}</td>
                            <td class="td-date">${item.date}</td>
                            <td class="td-desc">${item.desc}</td>
                            <td class="td-vendor">${item.vendor}</td>
                            <td class="td-amount">${formatINR(item.amount)}</td>
                            <td>${statusBadge}</td>
                            <td class="table-actions-cell">${actionsCell}</td>
                        </tr>
                    `;
                });
            }

            const addButtonHTML = authState.isAdmin
                ? `<button onclick="promptAddItem('${divKey}')" class="btn-add-action">
                       <i class="fa-solid fa-plus"></i> Add Item
                   </button>`
                : '';

            container.innerHTML = `
                <div class="division-header-panel">
                    <div class="division-header-left">
                        <h2>${data.title}</h2>
                        <span class="card-subtext-muted" style="text-transform: uppercase; letter-spacing: 0.1em; font-family: monospace;">FORMULA BHARAT 2027 • MREX-03</span>
                    </div>

                    <div class="metrics-flex-row-box">
                        <div class="radial-progress-svg-container" style="width: 5rem; height: 5rem; margin-bottom: 0;">
                            <svg viewBox="0 0 36 36">
                                <path class="svg-circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <path class="svg-circle-fill-amber" stroke-dasharray="${paidRatio}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            </svg>
                            <div class="absolute-radial-center">
                                <span style="font-size: 0.875rem; font-weight:700; color:var(--text-primary);">${paidRatio}%</span>
                                <span style="font-size: 6px; color: var(--text-muted); text-transform: uppercase; display:block;">paid</span>
                            </div>
                        </div>

                        <div class="sub-metrics-grid-block">
                            <div class="mini-stat-card">
                                <span class="stat-label-tiny">Expected Cost</span>
                                <span class="val-primary">${formatINR(totalExpected)}</span>
                            </div>
                            <div class="mini-stat-card">
                                <span class="stat-label-tiny">Spent (Paid)</span>
                                <span class="val-amber">${formatINR(spent)}</span>
                            </div>
                            <div class="mini-stat-card">
                                <span class="stat-label-tiny">Pending</span>
                                <span class="val-amber">${formatINR(pending)}</span>
                            </div>
                            <div class="mini-stat-card">
                                <span class="stat-label-tiny">Items</span>
                                <span class="val-primary">${itemCount}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="table-card-wrapper">
                    <div class="table-top-bar">
                        <h3>Expense Ledger — ${itemCount} items</h3>
                        ${addButtonHTML}
                    </div>

                    <div class="table-overflow-scroller">
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Vendor / Source</th>
                                    <th>Amount</th>
                                    <th>Status</th>
                                    <th style="text-align: right;">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowHTML}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        /* ---------------------------------------------------------
           LOGS VIEW (admin-only — commit / audit history)
           --------------------------------------------------------- */
        // Fetches commit/audit logs from the backend and renders them.
        // Assumes GET ${API_BASE_URL}/logs, gated by the same
        // X-Admin-Password header used for writes, returning JSON like:
        //   [{ sha, message, author, date, url }, ...]
        // ordered newest-first. Adjust field names below if your
        // backend's shape differs.
        async function renderLogsView(forceRefresh = false) {
            if (!authState.isAdmin) {
                // Safety net — should never be reachable via the UI since
                // switchTab() and rerenderCurrentView() already guard this,
                // but never render admin-only data without a live check.
                appState.currentTab = 'overview';
                renderOverview();
                return;
            }

            const container = document.getElementById('view-container');

            container.innerHTML = `
                <div class="table-card-wrapper">
                    <div class="table-top-bar">
                        <h3><i class="fa-solid fa-clock-rotate-left"></i> Commit Logs</h3>
                        <button class="btn-add-action" onclick="renderLogsView(true)">
                            <i class="fa-solid fa-rotate"></i> Refresh
                        </button>
                    </div>
                    <div id="logs-body-container">
                        <div class="loading-msg">Loading commit history…</div>
                    </div>
                </div>
            `;

            if (logsCache && !forceRefresh) {
                renderLogsList(logsCache);
                return;
            }

            try {
                const res = await fetch(`${API_BASE_URL}/logs`, {
                    method: 'GET',
                    headers: {
                        'X-Admin-Password': authState.password || ''
                    }
                });
                if (!res.ok) throw new Error(`Server returned ${res.status}`);

                const logs = await res.json();
                logsCache = Array.isArray(logs) ? logs : (logs.commits || []);
                renderLogsList(logsCache);
            } catch (err) {
                console.error('Failed to fetch commit logs:', err);
                const logsBody = document.getElementById('logs-body-container');
                if (logsBody) {
                    logsBody.innerHTML = `<div class="loading-msg" style="color: var(--accent-red);">Could not load commit logs from server.</div>`;
                }
                showToast('Could not load commit logs.', true);
            }
        }

        function renderLogsList(logs) {
            const logsBody = document.getElementById('logs-body-container');
            if (!logsBody) return;

            if (!logs || logs.length === 0) {
                logsBody.innerHTML = `<div class="loading-msg">No commit history yet.</div>`;
                return;
            }

            let rowsHTML = '';
            logs.forEach((entry) => {
                const sha = entry.sha ? String(entry.sha).slice(0, 7) : '—';
                const message = entry.message || entry.auditMessage || '(no message)';
                const author = entry.author || entry.committer || 'unknown';
                const date = entry.date
                    ? new Date(entry.date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : '—';

                const shaCell = entry.url
                    ? `<a href="${entry.url}" target="_blank" rel="noopener noreferrer" class="td-id" style="text-decoration: underline;">${sha}</a>`
                    : `<span class="td-id">${sha}</span>`;

                rowsHTML += `
                    <tr>
                        <td>${shaCell}</td>
                        <td class="td-date">${date}</td>
                        <td class="td-desc">${message}</td>
                        <td class="td-vendor">${author}</td>
                    </tr>
                `;
            });

            logsBody.innerHTML = `
                <div class="table-overflow-scroller">
                    <table>
                        <thead>
                            <tr>
                                <th>Commit</th>
                                <th>Date</th>
                                <th>Message</th>
                                <th>Author</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHTML}
                        </tbody>
                    </table>
                </div>
            `;
        }

        /* ---------------------------------------------------------
           ADMIN-ONLY MUTATIONS (all hit the backend; UI only
           re-renders once the backend confirms the change)
           --------------------------------------------------------- */
        function promptAddItem(divKey) {
            if (!authState.isAdmin) return;
            openExpenseModal(divKey);
        }

        function promptEditItem(divKey, itemId) {
            if (!authState.isAdmin) return;
            const division = appState.divisions[divKey];
            if (!division) return;
            const item = division.ledger.find(i => i.id === itemId);
            if (!item) return;
            openExpenseModal(divKey, item);
        }

        function openExpenseModal(divKey, itemToEdit = null) {
            // Remove existing backdrop if any
            closeExpenseModal();

            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.id = 'expense-modal-backdrop';

            const defaultDate = itemToEdit ? itemToEdit.date : new Date().toISOString().split('T')[0];
            const defaultDesc = itemToEdit ? itemToEdit.desc : '';
            const defaultVendor = itemToEdit ? itemToEdit.vendor : '';
            const defaultAmount = itemToEdit ? itemToEdit.amount : '';
            const isPendingSelected = !itemToEdit || itemToEdit.status === 'PENDING' ? 'selected' : '';
            const isPaidSelected = itemToEdit && itemToEdit.status === 'PAID' ? 'selected' : '';

            backdrop.innerHTML = `
                <div class="modal-box" style="max-width: 26rem;">
                    <h3>${itemToEdit ? 'Edit Expense Item' : 'Add Expense Item'}</h3>
                    <form id="expense-modal-form" onsubmit="saveExpenseItem(event, '${divKey}', ${itemToEdit ? `'${itemToEdit.id}'` : 'null'})">
                        <div style="margin-bottom: 0.75rem;">
                            <label for="expense-date">Date</label>
                            <input type="date" id="expense-date" required value="${defaultDate}" />
                        </div>
                        <div style="margin-bottom: 0.75rem;">
                            <label for="expense-desc">Description</label>
                            <input type="text" id="expense-desc" required placeholder="e.g. Chassis tubes" value="${defaultDesc.replace(/"/g, '&quot;')}" />
                        </div>
                        <div style="margin-bottom: 0.75rem;">
                            <label for="expense-vendor">Vendor / Source</label>
                            <input type="text" id="expense-vendor" required placeholder="e.g. Steel Tubes Co." value="${defaultVendor.replace(/"/g, '&quot;')}" />
                        </div>
                        <div style="margin-bottom: 0.75rem;">
                            <label for="expense-amount">Amount (INR)</label>
                            <input type="number" id="expense-amount" min="1" required placeholder="e.g. 50000" value="${defaultAmount}" />
                        </div>
                        <div style="margin-bottom: 1.25rem;">
                            <label for="expense-status">Status</label>
                            <select id="expense-status" required>
                                <option value="PENDING" ${isPendingSelected}>PENDING</option>
                                <option value="PAID" ${isPaidSelected}>PAID</option>
                            </select>
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-modal-cancel" onclick="closeExpenseModal()">Cancel</button>
                            <button type="submit" class="btn-modal-submit">${itemToEdit ? 'Save Changes' : 'Add Item'}</button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(backdrop);

            backdrop.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeExpenseModal();
            });

            const firstInput = document.getElementById('expense-date');
            if (firstInput) firstInput.focus();
        }

        function closeExpenseModal() {
            const backdrop = document.getElementById('expense-modal-backdrop');
            if (backdrop) backdrop.remove();
        }

        async function saveExpenseItem(event, divKey, itemId = null) {
            event.preventDefault();
            if (!authState.isAdmin) return;

            const dateVal = document.getElementById('expense-date').value.trim();
            const descVal = document.getElementById('expense-desc').value.trim();
            const vendorVal = document.getElementById('expense-vendor').value.trim();
            const amountVal = parseInt(document.getElementById('expense-amount').value.trim(), 10);
            const statusVal = document.getElementById('expense-status').value;

            if (!dateVal || !descVal || !vendorVal || isNaN(amountVal) || amountVal <= 0 || !statusVal) {
                showToast('All fields are required and amount must be positive.', true);
                return;
            }

            const division = appState.divisions[divKey];
            if (!division) return;

            if (itemId) {
                // Editing an existing item
                const item = division.ledger.find(i => i.id === itemId);
                if (!item) return;

                const originalItem = { ...item };
                item.date = dateVal;
                item.desc = descVal;
                item.vendor = vendorVal;
                item.amount = amountVal;
                item.status = statusVal;

                recalculateGlobalSpend();

                const auditMessage = `Updated ${item.id} (${division.title}): "${descVal}" - ${formatINR(amountVal)} (${statusVal})`;

                try {
                    await persistFullState(auditMessage);
                    closeExpenseModal();
                    rerenderCurrentView();
                    showToast('Item updated.');
                } catch (err) {
                    console.error('Failed to update item:', err);
                    Object.assign(item, originalItem);
                    recalculateGlobalSpend();
                    showToast('Could not save changes to server.', true);
                }
            } else {
                // Adding a new item
                const newItem = {
                    date: dateVal,
                    desc: descVal,
                    vendor: vendorVal,
                    amount: amountVal,
                    status: statusVal
                };

                const prefix = divKey.slice(0, 2).toUpperCase();
                const nextIndex = division.ledger.length + 1;
                const generatedId = `${prefix}-${String(nextIndex).padStart(2, '0')}`;
                const auditMessage = `Added ${generatedId} (${division.title}): "${descVal}" - ${formatINR(amountVal)} (${statusVal})`;

                try {
                    await addLedgerItem(divKey, newItem, auditMessage);
                    closeExpenseModal();
                } catch (err) {
                    // Error is already logged and toast shown
                }
            }
        }

        async function addLedgerItem(divKey, newItem, auditMessage = "") {
            const division = appState.divisions[divKey];
            const prefix = divKey.slice(0, 2).toUpperCase();
            const nextIndex = division.ledger.length + 1;
            newItem.id = `${prefix}-${String(nextIndex).padStart(2, '0')}`;

            division.ledger.push(newItem);
            recalculateGlobalSpend();

            try {
                await persistFullState(auditMessage);
                rerenderCurrentView();
                showToast('Item added.');
            } catch (err) {
                console.error('Failed to add item:', err);
                division.ledger.pop(); // roll back local change
                recalculateGlobalSpend();
                showToast('Could not save to server.', true);
                throw err;
            }
        }

        function openGlobalEditModal(key) {
            closeGlobalEditModal();

            const backdrop = document.createElement('div');
            backdrop.className = 'modal-backdrop';
            backdrop.id = 'global-edit-modal-backdrop';

            let fieldLabel = '';
            let defaultValue = 0;
            if (key === 'expectedTotal') {
                fieldLabel = 'Expected Total Cost (INR)';
                defaultValue = appState.global.expectedTotal;
            } else if (key === 'currentFunding') {
                fieldLabel = 'Current Funding (INR)';
                defaultValue = appState.global.currentFunding;
            }

            backdrop.innerHTML = `
                <div class="modal-box" style="max-width: 24rem;">
                    <h3>Edit Global Metric</h3>
                    <form id="global-edit-form" onsubmit="saveGlobalValue(event, '${key}')">
                        <div style="margin-bottom: 1.25rem;">
                            <label for="global-value">${fieldLabel}</label>
                            <input type="number" id="global-value" min="0" required value="${defaultValue}" />
                        </div>
                        <div class="modal-actions">
                            <button type="button" class="btn-modal-cancel" onclick="closeGlobalEditModal()">Cancel</button>
                            <button type="submit" class="btn-modal-submit">Save</button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(backdrop);

            backdrop.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeGlobalEditModal();
            });

            const input = document.getElementById('global-value');
            if (input) {
                input.focus();
                input.select();
            }
        }

        function closeGlobalEditModal() {
            const backdrop = document.getElementById('global-edit-modal-backdrop');
            if (backdrop) backdrop.remove();
        }

        async function saveGlobalValue(event, key) {
            event.preventDefault();
            if (!authState.isAdmin) return;

            const inputVal = parseInt(document.getElementById('global-value').value.trim(), 10);
            if (isNaN(inputVal) || inputVal < 0) {
                showToast('Please enter a valid non-negative number.', true);
                return;
            }

            const originalVal = appState.global[key];
            appState.global[key] = inputVal;

            const label = key === 'expectedTotal' ? 'Expected Total Cost' : 'Current Funding';
            const auditMessage = `Updated ${label} from ${formatINR(originalVal)} to ${formatINR(inputVal)}`;

            try {
                await persistFullState(auditMessage);
                closeGlobalEditModal();
                updateHeaderTotals();
                rerenderCurrentView();
                showToast('Global metric updated.');
            } catch (err) {
                console.error('Failed to update global metric:', err);
                appState.global[key] = originalVal; // rollback
                showToast('Could not save to server.', true);
            }
        }

        async function toggleItemStatus(divKey, itemId) {
            if (!authState.isAdmin) return;

            const division = appState.divisions[divKey];
            const item = division.ledger.find(i => i.id === itemId);
            if (!item) return;

            const previousStatus = item.status;
            item.status = previousStatus === 'PENDING' ? 'PAID' : 'PENDING';
            recalculateGlobalSpend();

            const auditMessage = `Toggled status of ${item.id} (${division.title}) to ${item.status}`;

            try {
                await persistFullState(auditMessage);
                rerenderCurrentView();
            } catch (err) {
                console.error('Failed to toggle status:', err);
                item.status = previousStatus; // roll back
                recalculateGlobalSpend();
                showToast('Could not update status.', true);
            }
        }

        async function deleteLedgerItem(divKey, itemId) {
            if (!authState.isAdmin) return;
            if (!confirm("Are you sure you want to remove this ledger entry?")) return;

            const division = appState.divisions[divKey];
            const index = division.ledger.findIndex(i => i.id === itemId);
            if (index === -1) return;

            const [removed] = division.ledger.splice(index, 1);
            recalculateGlobalSpend();

            const auditMessage = `Deleted item ${removed.id} (${division.title}): "${removed.desc}" - ${formatINR(removed.amount)}`;

            try {
                await persistFullState(auditMessage);
                rerenderCurrentView();
                showToast('Item removed.');
            } catch (err) {
                console.error('Failed to delete item:', err);
                division.ledger.splice(index, 0, removed); // roll back
                recalculateGlobalSpend();
                showToast('Could not delete item.', true);
            }
        }

        // Keeps global.spent in sync with PAID items across all divisions
        // (mirrors what the original frontend-only version did).
        function recalculateGlobalSpend() {
            let runningSpent = 0;
            for (const div of Object.values(appState.divisions)) {
                runningSpent += div.ledger
                    .filter(i => i.status === 'PAID')
                    .reduce((sum, i) => sum + i.amount, 0);
            }
            appState.global.spent = runningSpent;
            updateHeaderTotals();
        }

        /* ---------------------------------------------------------
           BOOT
           --------------------------------------------------------- */
        window.addEventListener('DOMContentLoaded', async () => {
            await restoreAdminSession();
            renderAuthZone();
            updateLogsTabVisibility();
            await fetchExpenseData();
            updateHeaderTotals();
            switchTab('overview');
        });