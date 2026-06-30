const API_BASE_URL = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
  ? "http://127.0.0.1:5000/api" 
  : window.location.origin + "/api";


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
        async function persistFullState() {
            const res = await fetch(`${API_BASE_URL}/data`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Password': authState.password || ''
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
            renderAuthZone();
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

            container.innerHTML = `
                <div class="cards-grid-3">
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Expected Total Cost</span>
                        <h2 class="card-title-macro">${formatINR(appState.global.expectedTotal)}</h2>
                        <span class="card-subtext-muted">Across ${Object.keys(appState.divisions).length} divisions</span>
                    </div>
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Current Funding</span>
                        <h2 class="card-title-macro-green">${formatINR(appState.global.currentFunding)}</h2>
                        <span class="card-subtext-muted">${fundingPercent}% of expected cost</span>
                    </div>
                    <div class="dashboard-card">
                        <span class="stat-label-tiny">Funds Available</span>
                        <h2 class="card-title-macro">${formatINR(fundsAvailable)}</h2>
                        <span class="card-subtext-muted">Funding minus paid out (${formatINR(appState.global.spent)} spent)</span>
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
                        ? `<button onclick="deleteLedgerItem('${divKey}', '${item.id}')" class="btn-trash" title="Delete entry"><i class="fa-solid fa-trash-can text-xs"></i></button>`
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
           ADMIN-ONLY MUTATIONS (all hit the backend; UI only
           re-renders once the backend confirms the change)
           --------------------------------------------------------- */
        function promptAddItem(divKey) {
            if (!authState.isAdmin) return;

            const descInput = prompt("Enter item description:", "");
            if (!descInput) return;
            const vendorInput = prompt("Enter Vendor / Material Source:", "");
            const amountInput = parseInt(prompt("Enter expense amount (INR):", "0"), 10);

            if (isNaN(amountInput) || amountInput <= 0) {
                alert("Please enter a valid positive numerical value.");
                return;
            }

            addLedgerItem(divKey, {
                date: new Date().toISOString().split('T')[0],
                desc: descInput,
                vendor: vendorInput || "N/A",
                amount: amountInput,
                status: "PENDING"
            });
        }

        async function addLedgerItem(divKey, newItem) {
            const division = appState.divisions[divKey];
            const prefix = divKey.slice(0, 2).toUpperCase();
            const nextIndex = division.ledger.length + 1;
            newItem.id = `${prefix}-${String(nextIndex).padStart(2, '0')}`;

            division.ledger.push(newItem);
            recalculateGlobalSpend();

            try {
                await persistFullState();
                rerenderCurrentView();
                showToast('Item added.');
            } catch (err) {
                console.error('Failed to add item:', err);
                division.ledger.pop(); // roll back local change
                recalculateGlobalSpend();
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

            try {
                await persistFullState();
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

            try {
                await persistFullState();
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
            await fetchExpenseData();
            updateHeaderTotals();
            switchTab('overview');
        });