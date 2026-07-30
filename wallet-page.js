/**
 * wallet-page.js — Full-page wallet UI logic (for wallet.html opened as tab)
 * Same functionality as popup.js but for the full-page version.
 */

const status = document.getElementById("status");
    
    function setStatus(msg, type = "") {
      status.textContent = msg;
      status.className = "status " + type;
    }

    function show(viewId) {
      for (const id of ["onboarding", "createView", "importView", "unlockView", "walletView", "mnemonicView", "walletListView", "reauthView", "contactsView"]) {
        document.getElementById(id).classList.add("hidden");
      }
      document.getElementById(viewId).classList.remove("hidden");
    }

    window.copyEl = async function(el) {
      try {
        await navigator.clipboard.writeText(el.textContent);
        const orig = el.style.borderColor;
        el.style.borderColor = "#4caf50";
        setTimeout(() => el.style.borderColor = orig, 1000);
      } catch {}
    };

    // --- Theme toggle ---
    function applyTheme(theme) {
      document.body.className = "theme-" + theme;
      const btn = document.getElementById("themeToggle");
      if (btn) btn.textContent = theme === "dark" ? "🌙" : "☀️";
    }
    const savedTheme = localStorage.getItem("mmx_theme") || "dark";
    applyTheme(savedTheme);
    document.getElementById("themeToggle").onclick = () => {
      const isDark = document.body.className === "theme-dark";
      const newTheme = isDark ? "light" : "dark";
      applyTheme(newTheme);
      localStorage.setItem("mmx_theme", newTheme);
    };

    // --- Settings modal ---
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsModal = document.getElementById("settingsModal");
    if (settingsBtn) settingsBtn.onclick = () => {
      settingsModal.style.display = "flex";
      document.getElementById("rpcUrlInput").value = api.getNodeUrl();
      document.getElementById("rpcStatus").textContent = "Current: " + api.getNodeUrl();
    };
    const rpcPresetOfficial = document.getElementById("rpcPresetOfficial");
    if (rpcPresetOfficial) rpcPresetOfficial.onclick = () => {
      document.getElementById("rpcUrlInput").value = "https://rpc.mmx.network";
    };
    const rpcPresetLocal = document.getElementById("rpcPresetLocal");
    if (rpcPresetLocal) rpcPresetLocal.onclick = () => {
      document.getElementById("rpcUrlInput").value = "http://localhost:11380/wapi";
    };
    const rpcSaveBtn = document.getElementById("rpcSaveBtn");
    if (rpcSaveBtn) rpcSaveBtn.onclick = async () => {
      const url = document.getElementById("rpcUrlInput").value.trim();
      if (!url) return;
      const savedUrl = await api.saveNodeUrl(url);
      const note = savedUrl !== url.replace(/\/+$/, "") ? ' (auto-added /wapi)' : '';
      document.getElementById("rpcStatus").innerHTML = '<span style="color:#4caf50">✓ Saved! RPC set to ' + savedUrl + note + '</span>';
      document.getElementById("rpcUrlInput").value = api.getNodeUrl();
    };

    // --- Load ---
    try {
      setStatus("Loading crypto libraries...");
      const app = await import("./wallet-app.js");
      const api = await import("./mmx-node-api.js");
      const { bech32m } = await import("./lib/bech32-esm.js");
      await api.initNodeUrl();
      await app.init();
      setStatus("Ready");
      window.app = app;
      window.api = api;
      window.bech32m = bech32m;

      const wallets = await app.getWalletsList();
      if (wallets.length === 0) {
        show("onboarding");
      } else {
        // Show unlock for active wallet (or first)
        const activeId = (await app.getActiveWalletId()) || wallets[0].id;
        const wallet = wallets.find(w => w.id === activeId) || wallets[0];
        await app.setActiveWalletId(wallet.id);
        document.getElementById("unlockWalletName").textContent = wallet.name;
        show("unlockView");
      }

      // --- Onboarding ---
      document.getElementById("onboardCreate").onclick = () => show("createView");
      document.getElementById("onboardImport").onclick = () => show("importView");

      // --- Create ---
      document.getElementById("createCancel").onclick = async () => {
        const wallets = await app.getWalletsList();
        if (wallets.length > 0) show("walletListView"); else show("onboarding");
      };
      document.getElementById("createBtn").onclick = async () => {
        const name = document.getElementById("createName").value.trim() || "My Wallet";
        const pass = document.getElementById("createPass").value;
        const pass2 = document.getElementById("createPass2").value;
        if (!pass) return setStatus("Password is required", "error");
        if (pass !== pass2) return setStatus("Passwords don't match", "error");
        if (pass.length < 4) return setStatus("Password too short (min 4 chars)", "error");
        
        setStatus("Creating wallet...", "loading");
        try {
          const { mnemonic } = await app.createWallet(name, pass);
          // Show mnemonic
          document.getElementById("mnemonicDisplay").textContent = mnemonic.join("  ");
          show("mnemonicView");
          setStatus("Wallet created! Save your mnemonic words.", "success");
        } catch(e) { setStatus("Error: " + e.message, "error"); }
      };

      // --- Import ---
      document.getElementById("importCancel").onclick = async () => {
        const wallets = await app.getWalletsList();
        if (wallets.length > 0) show("walletListView"); else show("onboarding");
      };
      document.getElementById("importBtn").onclick = async () => {
        const name = document.getElementById("importName").value.trim() || "Imported Wallet";
        const mnemonicStr = document.getElementById("importMnemonic").value.trim();
        const pass = document.getElementById("importPass").value;
        const words = mnemonicStr.split(/\s+/).filter(w => w);
        if (words.length !== 24) return setStatus("Mnemonic must be exactly 24 words", "error");
        if (!pass) return setStatus("Password is required", "error");
        
        setStatus("Importing wallet...", "loading");
        try {
          await app.importWallet(name, words, pass);
          await renderWallet();
          setStatus("Wallet imported!", "success");
        } catch(e) { setStatus("Error: " + e.message, "error"); }
      };

      // --- Unlock ---
      document.getElementById("unlockCancel").onclick = () => show("walletListView");
      document.getElementById("unlockBtn").onclick = async () => {
        const pass = document.getElementById("unlockPass").value;
        if (!pass) return setStatus("Enter password", "error");
        const walletId = await app.getActiveWalletId();
        try {
          await app.unlockWallet(walletId, pass);
          await renderWallet();
          setStatus("Unlocked", "success");
        } catch(e) { setStatus("Wrong password", "error"); }
      };

      // --- Mnemonic view ---
      document.getElementById("mnemonicDone").onclick = async () => {
        await renderWallet();
        setStatus("Welcome to your wallet!", "success");
      };

      // --- Wallet view ---
      let txOffset = 0;
      let allTxs = [];

      async function renderWallet() {
        show("walletView");
        const wallet = app.getUnlockedWallet();
        document.getElementById("displayWalletName").textContent = wallet.name;
        document.getElementById("displayAddress").textContent = wallet.address;
        // Show wallet count
        const wallets = await app.getWalletsList();
        document.getElementById("walletCount").textContent = wallets.length > 1 ? `(${wallets.length} wallets)` : "";
        await refreshBalance();
        // Update network badge with block height
        updateNetworkBadge();
        // Start auto-refresh
        app.startAutoRefresh(async () => {
          await refreshBalance();
          updateNetworkBadge();
          setStatus("Balance updated", "success");
          setTimeout(() => setStatus(""), 2000);
        });
        // Fetch transaction history (first page, with retry)
        txOffset = 0;
        try {
          const txs = await app.getTransactionHistory(15, 0);
          allTxs = txs;
          renderTxHistory(txs);
          document.getElementById("txLoadMore").style.display = txs.length >= 15 ? "block" : "none";
        } catch(e) {
          console.error("TX history error:", e.message);
          // Retry once after 2s (wallet might not be fully ready)
          setTimeout(async () => {
            try {
              const txs = await app.getTransactionHistory(15, 0);
              allTxs = txs;
              renderTxHistory(txs);
              document.getElementById("txLoadMore").style.display = txs.length >= 15 ? "block" : "none";
            } catch(e2) {
              document.getElementById("txHistoryList").innerHTML = '<div style="color:#888;font-size:12px;">Failed to load history</div>';
              console.error("TX history retry failed:", e2.message);
            }
          }, 2000);
        }
        // Populate contact picker (separate from tx history so it works even if tx history fails)
        try { await populateContactPicker(); } catch {}
      }

      function renderTxHistory(txs, append = false) {
        const list = document.getElementById("txHistoryList");
        if (!txs || txs.length === 0) {
          if (!append) list.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;">No transactions yet</div>';
          return;
        }
        let html = "";
        for (const tx of txs) {
          const isSent = tx.direction === 'sent';
          const arrow = isSent ? '📤' : '📥';
          const color = isSent ? '#f44336' : '#4caf50';
          const addrShort = app.escapeHtml(tx.id.substring(0, 12)) + '...';
          const confirmations = tx.confirm || 0;
          const pendingBadge = confirmations < 1 ? ' <span style="color:#ff9800;font-size:10px;">⏳ pending</span>' : '';
          html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:16px;">${arrow}</span>
              <div>
                <div style="font-size:13px;font-weight:600;color:${color};">${isSent ? '-' : '+'}${app.escapeHtml(tx.amount)} ${app.escapeHtml(tx.symbol)}${pendingBadge}</div>
                <div style="font-family:monospace;font-size:10px;color:#666;">${addrShort} · block ${app.escapeHtml(tx.height)}</div>
              </div>
            </div>
            <a href="https://explore.mmx.network/#/explore/transaction/${app.escapeHtml(tx.id)}" target="_blank" style="color:#555;font-size:12px;text-decoration:none;">↗</a>
          </div>`;
        }
        if (append) list.innerHTML += html;
        else list.innerHTML = html;
      }

      async function updateNetworkBadge() {
        const badge = document.getElementById("networkBadge");
        try {
          const height = await api.getHeight();
          badge.textContent = `mainnet · ✓ h:${height}`;
          badge.style.color = "#4caf50";
        } catch {
          badge.textContent = "mainnet · ✗ offline";
          badge.style.color = "#f44336";
        }
      }

      async function refreshBalance() {
        document.getElementById("balanceList").innerHTML = '<div style="color:#888;font-size:13px;">Loading balances...</div>';
        try {
          const balances = await app.fetchBalance();
          const sendCurrency = document.getElementById("sendCurrency");
          sendCurrency.innerHTML = "";
          if (balances.length === 0) {
            document.getElementById("balanceList").innerHTML = '<div style="color:#888;font-size:13px;">No balances yet</div>';
            return;
          }
          let html = "";
          for (const b of balances) {
            const spendable = b.spendable !== undefined ? b.spendable : b.total || 0;
            html += `<div class="balance-row">
              <span class="balance-symbol">${app.escapeHtml(b.symbol || '?')}</span>
              <span class="balance-amount">${app.escapeHtml(spendable)}</span>
            </div>`;
            sendCurrency.innerHTML += `<option value="${app.escapeHtml(b.symbol)}">${app.escapeHtml(b.symbol)}</option>`;
          }
          document.getElementById("balanceList").innerHTML = html;
        } catch(e) {
          document.getElementById("balanceList").innerHTML = `<div style="color:#f44336;font-size:13px;">${app.escapeHtml(e.message)}</div>`;
        }
      }

      document.getElementById("refreshBtn").onclick = () => {
        setStatus("Refreshing...", "loading");
        refreshBalance().then(() => setStatus("Balances updated", "success"));
      };

      // --- Send ---
      // --- Send (review → confirm → broadcast) ---
      let pendingSend = null; // { toAddr, amountSat, contractAddr, decimals, currency, amountStr }

      document.getElementById("sendBtn").onclick = async () => {
        const toAddr = document.getElementById("sendTo").value.trim();
        const amountStr = document.getElementById("sendAmount").value.trim();
        const currency = document.getElementById("sendCurrency").value;
        const memo = document.getElementById("sendMemo").value.trim() || null;
        
        if (!toAddr || !toAddr.startsWith("mmx1")) return setStatus("Enter a valid MMX address", "error");
        if (!amountStr) return setStatus("Enter an amount", "error");
        
        // Validate address checksum
        try {
          const decoded = bech32m.decode(toAddr);
          if (!decoded || decoded.prefix !== "mmx") return setStatus("Invalid MMX address (checksum failed)", "error");
          const bytes = bech32m.fromWords(decoded.words);
          if (bytes.length !== 32) return setStatus("Invalid MMX address (wrong length)", "error");
        } catch { return setStatus("Invalid MMX address", "error"); }
        
        // Send-to-self warning
        const myAddr = app.getUnlockedWallet()?.address;
        if (toAddr === myAddr) return setStatus("⚠️ That's your own address — sending to yourself just wastes a fee", "error");
        
        // Look up currency contract address and decimals
        let contractAddr = null;
        let decimals = 6;
        if (currency !== "MMX") {
          try {
            const balances = await app.fetchBalance();
            const token = balances.find(b => b.symbol === currency);
            if (token) { contractAddr = token.contract; decimals = token.decimals || 0; }
          } catch {}
        }
        const amountSat = app.mmxToSat(amountStr, decimals);
        if (!amountSat || amountSat <= 0n) return setStatus("Invalid amount", "error");
        
        // Dynamic fee estimate
        let feeSat = 50000n;
        try { feeSat = await api.getFeeEstimate(); } catch {}
        
        // Balance check: verify sufficient funds
        try {
          const balances = await app.fetchBalance();
          const token = balances.find(b => b.symbol === currency);
          const spendable = token ? BigInt(Math.floor(token.spendable * Math.pow(10, token.decimals || 0))) : 0n;
          if (currency === "MMX") {
            if (spendable < amountSat + feeSat) {
              const have = (Number(spendable) / 1e6).toFixed(6);
              const need = (Number(amountSat + feeSat) / 1e6).toFixed(6);
              return setStatus(`Insufficient balance: have ${have} MMX, need ${need} MMX (incl. fee)`, "error");
            }
          } else {
            if (spendable < amountSat)
              return setStatus(`Insufficient ${currency}: have ${token?.spendable ?? 0}, need ${amountStr}`, "error");
            const mmxBal = balances.find(b => b.symbol === "MMX");
            const mmxSpendable = mmxBal ? BigInt(Math.floor(mmxBal.spendable * 1e6)) : 0n;
            if (mmxSpendable < feeSat)
              return setStatus(`Insufficient MMX for fee: need ${(Number(feeSat) / 1e6).toFixed(6)} MMX`, "error");
          }
        } catch {}
        
        // Show confirm card
        pendingSend = { toAddr, amountSat, contractAddr, decimals, currency, amountStr, memo };
        const feeMmx = (Number(feeSat) / 1e6).toFixed(6);
        document.getElementById("confirmAmount").textContent = `${amountStr} ${currency}`;
        document.getElementById("confirmTo").textContent = toAddr;
        document.getElementById("confirmFee").textContent = `~${feeMmx} MMX`;
        const totalStr = currency === "MMX" ? `${(parseFloat(amountStr) + parseFloat(feeMmx)).toFixed(6)} MMX` : `${amountStr} ${currency} + ${feeMmx} MMX fee`;
        document.getElementById("confirmTotal").textContent = totalStr;
        // Show memo in confirm card if present
        if (memo) {
          document.getElementById("confirmMemo").textContent = memo;
          document.getElementById("confirmMemoRow").style.display = "block";
        } else {
          document.getElementById("confirmMemoRow").style.display = "none";
        }
        document.getElementById("sendConfirmStatus").textContent = "";
        document.getElementById("sendConfirmCard").style.display = "block";
      };

      document.getElementById("sendCancelBtn").onclick = () => {
        document.getElementById("sendConfirmCard").style.display = "none";
        pendingSend = null;
      };

      document.getElementById("sendBroadcastBtn").onclick = async () => {
        if (!pendingSend) return;
        const btn = document.getElementById("sendBroadcastBtn");
        btn.disabled = true;
        document.getElementById("sendConfirmStatus").textContent = "Sending...";
        try {
          const sendResult = await app.sendTransaction(pendingSend.toAddr, pendingSend.amountSat, pendingSend.contractAddr, pendingSend.memo);
          document.getElementById("sendConfirmCard").style.display = "none";
          document.getElementById("sendTo").value = "";
          document.getElementById("sendAmount").value = "";
          document.getElementById("sendMemo").value = "";
          setStatus(`✅ Sent! TXID: ${sendResult.txid} Fee: ${sendResult.fee_value} MMX`, "success");
          await refreshBalance();
          // Fetch updated tx history (new tx will show as pending)
          try {
            txOffset = 0;
            const txs = await app.getTransactionHistory(15, 0);
            allTxs = txs;
            renderTxHistory(txs);
            document.getElementById("txLoadMore").style.display = txs.length >= 15 ? "block" : "none";
          } catch {}
          pendingSend = null;
        } catch(e) {
          document.getElementById("sendConfirmStatus").textContent = "Error: " + e.message;
        } finally {
          btn.disabled = false;
        }
      };

      // Load more transactions
      document.getElementById("txLoadMore").onclick = async () => {
        txOffset += 15;
        try {
          const btn = document.getElementById("txLoadMore");
          btn.textContent = "Loading...";
          const txs = await app.getTransactionHistory(15, txOffset);
          allTxs = allTxs.concat(txs);
          renderTxHistory(txs, true);
          btn.textContent = "Load More";
          btn.style.display = txs.length >= 15 ? "block" : "none";
        } catch {
          txOffset -= 15;
        }
      };

      // --- Mnemonic ---
      // --- Reauth view (inline password for show mnemonic / delete) ---
      let reauthAction = null;
      let reauthDeleteId = null;
      function showReauth(title, msg, action) {
        reauthAction = action;
        reauthDeleteId = null;
        document.getElementById("reauthTitle").textContent = title;
        document.getElementById("reauthMsg").textContent = msg;
        document.getElementById("reauthPass").value = "";
        document.getElementById("reauthStatus").textContent = "";
        show("reauthView");
        setTimeout(() => document.getElementById("reauthPass").focus(), 50);
      }
      document.getElementById("reauthCancelBtn").onclick = () => {
        if (reauthDeleteId) { show("walletListView"); }
        else { show("walletView"); }
      };
      document.getElementById("reauthConfirmBtn").onclick = async () => {
        const pwd = document.getElementById("reauthPass").value;
        if (!pwd) return setStatus("reauthStatus", "Password required", "error");
        try {
          if (reauthAction === 'mnemonic') {
            const mnemonic = await app.showMnemonic(pwd);
            document.getElementById("mnemonicDisplay").textContent = mnemonic.join("  ");
            show("mnemonicView");
          } else if (reauthAction === 'delete') {
            const id = reauthDeleteId || await app.getActiveWalletId();
            await app.unlockWallet(id, pwd); // verify password
            await app.deleteWalletById(id);
            const wallets = await app.getWalletsList();
            if (wallets.length === 0) {
              show("onboarding");
              setStatus("Wallet deleted", "");
            } else {
              await app.setActiveWalletId(wallets[0].id);
              document.getElementById("unlockWalletName").textContent = wallets[0].name;
              show("unlockView");
              setStatus("Wallet deleted", "");
            }
          }
        } catch { setStatus("reauthStatus", "Wrong password", "error"); }
      };
      document.getElementById("reauthPass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("reauthConfirmBtn").click();
      });

      // --- Show mnemonic (requires password) ---
      document.getElementById("showMnemonicBtn").onclick = () => {
        showReauth("Show Mnemonic", "Enter your password to reveal your 24-word seed:", 'mnemonic');
      };

      // --- Switch wallet ---
      // Extracted to named function for reuse
      async function renderWalletList() {
        const wallets = await app.getWalletsList();
        const activeId = await app.getActiveWalletId();
        let html = "";
        for (const w of wallets) {
          const isActive = w.id === activeId ? " active" : "";
          html += `<div class="wallet-list-item${isActive}" data-id="${app.escapeHtml(w.id)}" style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div class="wallet-name">${app.escapeHtml(w.name)}</div>
              <div class="wallet-addr">${app.escapeHtml(w.address.substring(0,20))}...${app.escapeHtml(w.address.slice(-8))}</div>
            </div>
            <button class="btn-delete-wallet" data-id="${app.escapeHtml(w.id)}" style="background:none;border:1px solid rgba(244,67,54,0.3);border-radius:6px;padding:4px 8px;color:#f44336;font-size:11px;cursor:pointer;">🗑</button>
          </div>`;
        }
        document.getElementById("walletListItems").innerHTML = html;
        show("walletListView");
        
        for (const el of document.querySelectorAll(".wallet-list-item")) {
          el.onclick = async (e) => {
            if (e.target.classList.contains("btn-delete-wallet")) return;
            const id = el.dataset.id;
            await app.setActiveWalletId(id);
            app.lockWalletPub();
            const wallet = (await app.getWalletsList()).find(w => w.id === id);
            document.getElementById("unlockWalletName").textContent = wallet.name;
            document.getElementById("unlockPass").value = "";
            show("unlockView");
          };
        }
        // Delete button handlers
        for (const btn of document.querySelectorAll(".btn-delete-wallet")) {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const wallets = await app.getWalletsList();
            const w = wallets.find(x => x.id === id);
            if (!w) return;
            // Use reauth view for password
            reauthAction = 'delete';
            reauthDeleteId = id;
            document.getElementById("reauthTitle").textContent = `Delete "${w.name}"`;
            document.getElementById("reauthMsg").textContent = "Enter password to delete this wallet. Make sure you have your mnemonic saved!";
            document.getElementById("reauthPass").value = "";
            document.getElementById("reauthStatus").textContent = "";
            show("reauthView");
            setTimeout(() => document.getElementById("reauthPass").focus(), 50);
          };
        }
      }
      document.getElementById("switchWalletBtn").onclick = renderWalletList;

      // --- Contacts (address book) ---
      async function renderContacts() {
        const contacts = await app.getContacts();
        const list = document.getElementById("contactsList");
        if (contacts.length === 0) {
          list.innerHTML = '<div style="color:#888;font-size:13px;text-align:center;padding:12px;">No saved contacts yet. Addresses you send to will be auto-saved here.</div>';
        } else {
          let html = "";
          for (const c of contacts) {
            html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div>
                <div style="font-size:14px;font-weight:600;">${app.escapeHtml(c.name)}</div>
                <div style="font-family:monospace;font-size:11px;color:#666;">${app.escapeHtml(c.address.substring(0,24))}...</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn" data-addr="${app.escapeHtml(c.address)}" style="font-size:11px;padding:4px 10px;">📤 Send</button>
                <button class="btn danger" data-del="${app.escapeHtml(c.id)}" style="font-size:11px;padding:4px 10px;">🗑</button>
              </div>
            </div>`;
          }
          list.innerHTML = html;
          for (const btn of list.querySelectorAll("button[data-addr]")) {
            btn.onclick = () => {
              document.getElementById("sendTo").value = btn.dataset.addr;
              show("walletView");
            };
          }
          for (const btn of list.querySelectorAll("button[data-del]")) {
            btn.onclick = async () => {
              await app.deleteContact(btn.dataset.del);
              await renderContacts();
              await populateContactPicker();
            };
          }
        }
      }
      async function populateContactPicker() {
        const contacts = await app.getContacts();
        const select = document.getElementById("sendToContact");
        select.innerHTML = '<option value="">Select from contacts...</option>';
        for (const c of contacts) {
          select.innerHTML += `<option value="${app.escapeHtml(c.address)}">${app.escapeHtml(c.name)} — ${app.escapeHtml(c.address.substring(0,12))}...</option>`;
        }
      }
      document.getElementById("contactsBtn").onclick = async () => {
        try {
          await renderContacts();
          show("contactsView");
        } catch(e) {
          setStatus("Contacts error: " + e.message, "error");
          console.error("Contacts error:", e);
        }
      };
      document.getElementById("contactsBackBtn").onclick = () => show("walletView");
      document.getElementById("addContactBtn").onclick = async () => {
        const name = document.getElementById("contactName").value.trim();
        const addr = document.getElementById("contactAddr").value.trim();
        const status = document.getElementById("contactStatus");
        if (!name) { status.textContent = "Enter a name"; status.className = "status error"; return; }
        if (!addr || !addr.startsWith("mmx1")) { status.textContent = "Enter a valid MMX address"; status.className = "status error"; return; }
        try {
          await app.addContact(name, addr);
          document.getElementById("contactName").value = "";
          document.getElementById("contactAddr").value = "";
          status.textContent = "Contact added!";
          status.className = "status success";
          await renderContacts();
          await populateContactPicker();
        } catch (e) {
          status.textContent = e.message || "Failed to add contact";
          status.className = "status error";
        }
      };
      document.getElementById("sendToContact").onchange = (e) => {
        if (e.target.value) document.getElementById("sendTo").value = e.target.value;
      };

      document.getElementById("listCancel").onclick = async () => {
        if (app.isUnlocked()) await renderWallet();
        else {
          const walletId = await app.getActiveWalletId();
          const wallet = (await app.getWalletsList()).find(w => w.id === walletId);
          if (wallet) {
            document.getElementById("unlockWalletName").textContent = wallet.name;
            show("unlockView");
          } else { show("onboarding"); }
        }
      };
      document.getElementById("listCreateBtn").onclick = () => show("createView");
      document.getElementById("listImportBtn").onclick = () => show("importView");

      // --- Lock ---
      document.getElementById("lockBtn").onclick = () => {
        app.stopAutoRefresh();
        app.lockWalletPub();
      };

      // Register lock callback for auto-lock
      app.onLock(async () => {
        app.stopAutoRefresh();
        try {
          const walletId = await app.getActiveWalletId();
          const wallet = (await app.getWalletsList()).find(w => w.id === walletId);
          if (wallet) document.getElementById("unlockWalletName").textContent = wallet.name;
        } catch {}
        document.getElementById("unlockPass").value = "";
        show("unlockView");
        setStatus("Wallet locked", "");
      });

      // --- Delete ---
      // --- Delete (requires password) ---
      document.getElementById("deleteBtn").onclick = () => {
        showReauth("Delete Wallet", "Enter your password to permanently delete this wallet. Make sure you have your mnemonic saved!", 'delete');
      };

      // --- Auto-lock on inactivity ---
      document.addEventListener("click", () => { /* could reset timer */ });
      
    } catch(e) {
      setStatus("Error: " + e.message, "error");
      console.error(e);
    }