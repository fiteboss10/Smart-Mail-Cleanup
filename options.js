'use strict';

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let discoveredSenders  = new Map();
let rules              = [];
let settings = {
  defaultAgeDays:   30,
  deleteMode:       'trash',   // 'trash' | 'found' | 'permanent'
  autoRunOnStartup: false,
};
let isScanning    = false;
let scanCancelled = false;
let statusTimer   = null;

// Shared folder state — one list used by both Discover and Run
let sharedFoldersAll      = [];   // all folder objects loaded
let sharedFoldersSelected = [];   // user-checked subset

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const manifest = messenger.runtime.getManifest();
  const version  = manifest.version;
  document.getElementById('header-version').textContent = `v${version}`;

  // Wire About version (may not be visible yet but set it now)
  const aboutVer = document.getElementById('about-version');
  if (aboutVer) aboutVer.textContent = version;

  await loadSettings();
  await loadRules();
  setupFolderSelector();
  setupKeywords();
  setupTabs();
  setupDiscover();
  setupRules();
  setupRun();
  updateRunInfo();
  updateActionButtons();

  // Show disclaimer on first use — must accept before proceeding
  await checkDisclaimer();

  // Auto-load folders on open — no user click required
  await loadSharedFolders();
});

// ═══════════════════════════════════════════════════════════
// DISCLAIMER — shown once on first use, must be accepted
// ═══════════════════════════════════════════════════════════
async function checkDisclaimer() {
  const stored = await messenger.storage.local.get('disclaimerAccepted');
  if (stored.disclaimerAccepted) return;   // already accepted

  return new Promise(resolve => {
    const overlay = document.getElementById('disclaimer-overlay');
    overlay.style.display = 'flex';

    document.getElementById('disclaimer-accept').addEventListener('click', async () => {
      await messenger.storage.local.set({ disclaimerAccepted: true });
      overlay.style.display = 'none';
      resolve();
    });

    document.getElementById('disclaimer-reject').addEventListener('click', () => {
      // Close the tab/window — user chose not to accept
      window.close();
    });
  });
}


function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'run') updateRunInfo();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// SHARED FOLDER SELECTOR
// ═══════════════════════════════════════════════════════════
function setupFolderSelector() {
  document.getElementById('btn-load-folders').addEventListener('click', loadSharedFolders);
  document.getElementById('skip-special').addEventListener('change', () => {
    // Re-load if already loaded so the list reflects the new setting
    if (sharedFoldersAll.length) loadSharedFolders();
  });
  document.getElementById('select-all-folders').addEventListener('change', e => {
    document.querySelectorAll('.folder-chk').forEach(cb => { cb.checked = e.target.checked; });
    syncFolderSelection();
  });
}

async function loadSharedFolders() {
  const btn = document.getElementById('btn-load-folders');
  btn.disabled = true;
  document.getElementById('folder-loading').style.display   = 'block';
  document.getElementById('folder-list-area').style.display = 'none';

  try {
    const skipSp   = document.getElementById('skip-special').checked;
    const accounts = await messenger.accounts.list();
    sharedFoldersAll = await collectAllFolders(accounts, skipSp);

    const stored    = await messenger.storage.local.get('selectedFolderIds');
    const firstUse  = !stored.selectedFolderIds;  // key absent = never saved
    const savedIds  = new Set(stored.selectedFolderIds || []);

    // First use: check nothing — force a deliberate selection
    renderFolderList(sharedFoldersAll, savedIds, !firstUse && savedIds.size === 0, accounts);
    document.getElementById('folder-list-area').style.display = '';

    if (firstUse) {
      showStatus('👋 Welcome! Select the folders you want to scan, then use Discover or Run.');
    } else {
      const n = savedIds.size;
      showStatus(`Folders loaded — ${n} folder${n !== 1 ? 's' : ''} selected.`);
    }

  } catch (err) {
    showStatus(`❌ Error loading folders: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    document.getElementById('folder-loading').style.display = 'none';
    updateActionButtons();
  }
}

function renderFolderList(folders, savedIds, useAll, accounts) {
  const accountNames = {};
  for (const a of (accounts || [])) accountNames[a.id] = a.name;

  const tbody = document.getElementById('folder-tbody');
  tbody.innerHTML = folders.map(f => {
    const checked = useAll || savedIds.has(f.id);
    return `<tr>
      <td class="col-chk">
        <input type="checkbox" class="folder-chk" data-folder-id="${esc(f.id)}" ${checked ? 'checked' : ''}>
      </td>
      <td>${esc(f.name)}${f.path && f.path !== '/' && f.path !== '/' + f.name
          ? `<span class="sample-email">${esc(f.path)}</span>` : ''}</td>
      <td class="col-count muted" style="font-size:12px">${esc(accountNames[f.accountId] ?? '')}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.folder-chk').forEach(cb => {
    cb.addEventListener('change', syncFolderSelection);
  });

  syncFolderSelection();
}

async function syncFolderSelection() {
  const checkedIds = new Set(
    [...document.querySelectorAll('.folder-chk:checked')].map(cb => cb.dataset.folderId)
  );
  sharedFoldersSelected = sharedFoldersAll.filter(f => checkedIds.has(f.id));

  const total   = sharedFoldersAll.length;
  const checked = checkedIds.size;
  const summary = `${checked} of ${total} folder${total !== 1 ? 's' : ''} selected`;
  document.getElementById('folders-selected-count').textContent   = summary;
  document.getElementById('folder-selection-summary').textContent = ` — ${summary}`;

  // Keep select-all checkbox in sync
  const allCb = document.getElementById('select-all-folders');
  if (allCb) allCb.checked = checked === total && total > 0;

  updateRunInfo();
  updateActionButtons();

  // Persist to storage
  await messenger.storage.local.set({ selectedFolderIds: [...checkedIds] });
}

// Enable/disable Scan and Run buttons based on whether folders are selected
function updateActionButtons() {
  const hasSelection = sharedFoldersSelected.length > 0;
  const tip = hasSelection ? '' : 'Select at least one folder above first';

  const btnScan   = document.getElementById('btn-scan');
  const btnDryRun = document.getElementById('btn-dry-run');
  const btnRun    = document.getElementById('btn-run');

  if (btnScan)   { btnScan.disabled   = !hasSelection; btnScan.title   = tip; }
  if (btnDryRun) { btnDryRun.disabled = !hasSelection; btnDryRun.title = tip; }
  if (btnRun)    { btnRun.disabled    = !hasSelection; btnRun.title    = tip; }

  // Highlight the folder selector if nothing selected yet
  const card = document.querySelector('.folder-selector-card');
  if (card) card.classList.toggle('folder-selector-attention', !hasSelection);
}



// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
async function loadSettings() {
  const stored = await messenger.storage.local.get('settings');
  if (stored.settings) settings = { ...settings, ...stored.settings };
  // Migrate legacy moveToTrash boolean to deleteMode string
  if (settings.moveToTrash !== undefined && !settings.deleteMode) {
    settings.deleteMode = settings.moveToTrash ? 'trash' : 'permanent';
  }
  document.getElementById('default-age').value     = settings.defaultAgeDays;
  document.getElementById('delete-behavior').value = settings.deleteMode ?? 'trash';
  document.getElementById('auto-run').checked      = settings.autoRunOnStartup;
  renderKeywordTags();
}

async function saveSettings() {
  settings.defaultAgeDays   = parseInt(document.getElementById('default-age').value, 10) || 30;
  settings.deleteMode       = document.getElementById('delete-behavior').value;
  settings.autoRunOnStartup = document.getElementById('auto-run').checked;
  // keywords are saved immediately on add/remove, no action needed here
  await messenger.storage.local.set({ settings });
  showStatus('✅ Settings saved.');
  updateRunInfo();
}

function setupKeywords() {
  const input  = document.getElementById('keyword-input');
  const addBtn = document.getElementById('btn-add-keyword');

  const tryAdd = () => {
    const raw  = input.value.replace(/,/g, ' ').trim();
    const word = raw.toLowerCase();
    if (!word) return;
    if (!(settings.excludeKeywords ?? []).includes(word)) {
      settings.excludeKeywords = [...(settings.excludeKeywords ?? []), word];
      messenger.storage.local.set({ settings });
      renderKeywordTags();
    }
    input.value = '';
  };

  addBtn.addEventListener('click', tryAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tryAdd(); } });
}

function renderKeywordTags() {
  const keywords = settings.excludeKeywords ?? [];
  const container = document.getElementById('keyword-tags');
  container.innerHTML = keywords.map((kw, i) => `
    <span class="keyword-tag">
      ${esc(kw)}
      <button class="keyword-remove" data-idx="${i}" title="Remove">×</button>
    </span>`).join('');
  container.querySelectorAll('.keyword-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.target.dataset.idx;
      settings.excludeKeywords.splice(i, 1);
      messenger.storage.local.set({ settings });
      renderKeywordTags();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// RULES — persistence
// ═══════════════════════════════════════════════════════════
async function loadRules() {
  const stored = await messenger.storage.local.get('rules');
  rules = stored.rules || [];
  renderRules();
}

async function persistRules() {
  await messenger.storage.local.set({ rules });
}

// ═══════════════════════════════════════════════════════════
// RULES — render
// ═══════════════════════════════════════════════════════════
function renderRules() {
  const tbody = document.getElementById('rules-tbody');
  const noMsg = document.getElementById('no-rules-msg');
  document.getElementById('rules-count').textContent = rules.length;

  if (rules.length === 0) {
    tbody.innerHTML = '';
    noMsg.style.display = 'block';
    document.getElementById('rules-table-wrap').style.display = 'none';
    return;
  }
  noMsg.style.display = 'none';
  document.getElementById('rules-table-wrap').style.display = '';

  // Sort by root domain (last two segments), then full sender as tiebreaker
  const sorted = rules
    .map((rule, idx) => ({ rule, idx, sortKey: rootDomain(rule.sender) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.rule.sender.localeCompare(b.rule.sender));

  tbody.innerHTML = sorted.map(({ rule, idx }) => {
    const mt     = rule.matchType ?? 'domain';
    // Find domain to look up addresses — works whether sender is a domain or full address
    const domain = rule.sender.includes('@')
      ? rule.sender.split('@')[1]
      : rule.sender;
    const discovered = discoveredSenders.get(domain);
    const addrs      = discovered ? [...discovered.addresses.entries()].sort((a,b)=>b[1]-a[1]) : [];
    const hasAddrs   = addrs.length > 0;

    // Sender cell: address mode + discovered addresses → dropdown; otherwise text input
    const senderCell = (mt === 'address' && hasAddrs)
      ? `<select class="rule-sender-select" data-idx="${idx}" title="Select address">
           <option value="">— select address —</option>
           ${addrs.map(([addr, cnt]) =>
             `<option value="${esc(addr)}" ${rule.sender === addr ? 'selected' : ''}>
               ${esc(addr)} (${cnt})
             </option>`).join('')}
         </select>`
      : `<input type="text" class="rule-sender-input" data-idx="${idx}"
               value="${esc(rule.sender)}"
               placeholder="${mt === 'address' ? 'email@domain.com' : 'domain.com'}"
               title="Click to edit">`;

    return `
    <tr class="${rule.enabled ? '' : 'disabled'}" data-idx="${idx}">
      <td class="col-chk">
        <input type="checkbox" class="rule-enabled" data-idx="${idx}"
               ${rule.enabled ? 'checked' : ''} title="Enable/disable this rule">
      </td>
      <td>${senderCell}</td>
      <td class="col-match">
        <span class="match-badge match-badge-${mt}" data-idx="${idx}" title="Click to toggle domain/address matching">
          ${mt === 'address' ? '@ address' : '🌐 domain'}
        </span>
        ${mt === 'address' && !hasAddrs
          ? `<span class="hint" style="display:block;font-size:10px;margin-top:2px">scan to get dropdown</span>`
          : ''}
      </td>
      <td class="col-agechk">
        <input type="checkbox" class="rule-use-age" data-idx="${idx}"
               ${rule.useAge ? 'checked' : ''} title="Only delete messages older than the age below">
      </td>
      <td class="col-age">
        <input type="number" class="age-input rule-age-val" data-idx="${idx}"
               value="${rule.ageDays ?? ''}"
               placeholder="${settings.defaultAgeDays}"
               min="1" max="3650"
               ${rule.useAge ? '' : 'disabled'}
               title="Age in days; blank = use global default">
      </td>
      <td class="col-attach">
        <input type="checkbox" class="rule-skip-attach" data-idx="${idx}"
               ${rule.skipIfAttachment ? 'checked' : ''}
               title="Skip (keep) messages that have attachments">
      </td>
      <td class="col-del">
        <button class="btn-row-delete" data-idx="${idx}" title="Remove rule">✕</button>
      </td>
    </tr>`;
  }).join('');

  // --- enabled toggle
  tbody.querySelectorAll('.rule-enabled').forEach(cb => {
    cb.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      rules[i].enabled = e.target.checked;
      e.target.closest('tr').className = rules[i].enabled ? '' : 'disabled';
      persistRules();
    });
  });

  // --- age-based toggle
  tbody.querySelectorAll('.rule-use-age').forEach(cb => {
    cb.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      rules[i].useAge = e.target.checked;
      tbody.querySelector(`.rule-age-val[data-idx="${i}"]`).disabled = !rules[i].useAge;
      persistRules();
    });
  });

  // --- age value
  tbody.querySelectorAll('.rule-age-val').forEach(inp => {
    inp.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      rules[i].ageDays = parseInt(e.target.value, 10) || null;
      persistRules();
    });
  });

  // --- skip if attachment
  tbody.querySelectorAll('.rule-skip-attach').forEach(cb => {
    cb.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      rules[i].skipIfAttachment = e.target.checked;
      persistRules();
    });
  });

  // --- sender text input
  tbody.querySelectorAll('.rule-sender-input').forEach(inp => {
    inp.addEventListener('change', e => {
      const i = +e.target.dataset.idx;
      rules[i].sender = e.target.value.trim().toLowerCase();
      persistRules();
    });
  });

  // --- sender address dropdown
  tbody.querySelectorAll('.rule-sender-select').forEach(sel => {
    sel.addEventListener('change', e => {
      if (!e.target.value) return;   // ignore placeholder
      const i = +e.target.dataset.idx;
      rules[i].sender = e.target.value;
      persistRules();
    });
  });

  // --- match type toggle (click badge to switch domain ↔ address)
  tbody.querySelectorAll('.match-badge').forEach(badge => {
    badge.addEventListener('click', e => {
      const i  = +e.target.dataset.idx;
      const mt = rules[i].matchType ?? 'domain';
      rules[i].matchType = mt === 'domain' ? 'address' : 'domain';
      // If switching to address and we have discovered addresses, pre-fill with top address
      if (rules[i].matchType === 'address') {
        const domain     = rules[i].sender.includes('@') ? rules[i].sender.split('@')[1] : rules[i].sender;
        const discovered = discoveredSenders.get(domain);
        if (discovered?.addresses?.size) {
          const topAddr = [...discovered.addresses.entries()].sort((a,b)=>b[1]-a[1])[0][0];
          rules[i].sender = topAddr;
        }
      } else {
        // Switching back to domain — extract domain from current address if needed
        if (rules[i].sender.includes('@')) {
          rules[i].sender = rules[i].sender.split('@')[1];
        }
      }
      persistRules();
      renderRules();
    });
  });

  // --- delete row — also refresh Discover badges
  tbody.querySelectorAll('.btn-row-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = +e.target.dataset.idx;
      rules.splice(i, 1);
      persistRules();
      renderRules();
      if (discoveredSenders.size) renderDiscoveredSenders();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// RULES — setup event listeners
// ═══════════════════════════════════════════════════════════
function setupRules() {
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Apply delete mode immediately on change so Run uses the current value
  // even if the user hasn't clicked Save Settings
  document.getElementById('delete-behavior').addEventListener('change', e => {
    settings.deleteMode = e.target.value;
    updateRunInfo();
  });

  document.getElementById('btn-clear-rules').addEventListener('click', () => {
    if (!rules.length) { showStatus('No rules to clear.'); return; }
    showModal(
      '🗑 Clear All Rules',
      `Delete all ${rules.length} rules? This cannot be undone.`,
      async () => {
        rules = [];
        await persistRules();
        renderRules();
        if (discoveredSenders.size) renderDiscoveredSenders();
        showStatus('All rules cleared.');
      }
    );
  });

  document.getElementById('btn-export-rules').addEventListener('click', exportRules);
  document.getElementById('btn-import-rules').addEventListener('click', importRules);
}

function exportRules() {
  const blob = new Blob([JSON.stringify({ rules, settings }, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: 'smart-mail-cleanup.json' }).click();
  URL.revokeObjectURL(url);
  showStatus('Rules exported.');
}

function importRules() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.rules)) throw new Error('Missing rules array');
      rules = data.rules;
      if (data.settings) { settings = { ...settings, ...data.settings }; await messenger.storage.local.set({ settings }); await loadSettings(); }
      await persistRules();
      renderRules();
      if (discoveredSenders.size) renderDiscoveredSenders();
      showStatus(`✅ Imported ${rules.length} rules.`);
    } catch (err) {
      showStatus(`❌ Import failed: ${err.message}`, 'error');
    }
  });
  inp.click();
}

// ═══════════════════════════════════════════════════════════
// DISCOVER
// ═══════════════════════════════════════════════════════════
function setupDiscover() {
  document.getElementById('btn-scan').addEventListener('click', startScan);
  document.getElementById('btn-cancel-scan').addEventListener('click', () => { scanCancelled = true; });
  document.getElementById('discover-search').addEventListener('input', renderDiscoveredSenders);
  document.getElementById('discover-sort').addEventListener('change', renderDiscoveredSenders);
  document.getElementById('select-all-senders').addEventListener('change', e => {
    document.querySelectorAll('.sender-chk:not(:disabled)').forEach(cb => { cb.checked = e.target.checked; });
    syncSelectedCount();
  });
  document.getElementById('btn-add-to-rules').addEventListener('click', addSelectedToRules);
}

async function startScan() {
  if (isScanning) return;

  if (!sharedFoldersSelected.length) {
    showStatus('⚠️ Load folders first using the folder selector above.', 'warn');
    return;
  }

  isScanning        = true;
  scanCancelled     = false;
  discoveredSenders = new Map();

  document.getElementById('btn-scan').style.display         = 'none';
  document.getElementById('btn-cancel-scan').style.display  = '';
  document.getElementById('scan-progress').style.display    = 'block';
  document.getElementById('discover-controls').style.display = 'none';

  const fill   = document.getElementById('progress-fill');
  fill.style.animation = '';
  fill.style.width = '25%';

  try {
    const folders = sharedFoldersSelected;
    const total   = folders.length;
    let processed = 0;

    for (const folder of folders) {
      if (scanCancelled) break;

      const pct = total ? Math.round((processed / total) * 100) : 0;
      fill.style.animation = 'none';
      fill.style.width     = pct + '%';
      setProgressText(
        `Scanning "${folder.name}" (${processed}/${total} · ${discoveredSenders.size} senders found)`
      );

      try {
        let page = await messenger.messages.list(folder.id);
        let msgCount = 0;
        while (page && !scanCancelled) {
          msgCount += page.messages.length;
          for (const msg of page.messages) {
            if (!msg.author) continue;
            const domain = extractDomain(msg.author);
            if (!domain) continue;
            if (!discoveredSenders.has(domain)) {
              discoveredSenders.set(domain, { count: 0, sample: msg.author, addresses: new Map() });
            }
            const entry = discoveredSenders.get(domain);
            entry.count++;
            // Track individual addresses for the address-match feature
            const addr = extractAddress(msg.author);
            if (addr) entry.addresses.set(addr, (entry.addresses.get(addr) || 0) + 1);
          }
          page = page.id ? await messenger.messages.continueList(page.id) : null;
        }
        console.log(`Smart Mail Cleanup: "${folder.name}" → ${msgCount} messages`);
      } catch (e) {
        console.warn(`Smart Mail Cleanup: skipping "${folder.name}":`, e.message);
      }
      processed++;
    }

    fill.style.animation = 'none';
    fill.style.width = '100%';
    const msg = scanCancelled
      ? `Scan cancelled — ${discoveredSenders.size} senders found.`
      : `Done. ${discoveredSenders.size} unique senders in ${processed} folder${processed !== 1 ? 's' : ''}.`;
    setProgressText(msg);
    showStatus(msg);

    document.getElementById('scan-progress').style.display      = 'none';
    document.getElementById('discover-controls').style.display  = '';
    renderDiscoveredSenders();

  } catch (err) {
    showStatus(`❌ Scan error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    isScanning = false;
    document.getElementById('btn-scan').style.display        = '';
    document.getElementById('btn-cancel-scan').style.display = 'none';
    fill.style.animation = '';
    fill.style.width     = '25%';
  }
}





// Collect all scannable folders across all accounts.
// Tries several strategies to cope with Thunderbird version differences.
async function collectAllFolders(accounts, skipSpecial) {
  const skipTypes = ['trash', 'junk', 'sent', 'outbox', 'drafts', 'templates'];
  const result    = [];

  for (const account of accounts) {
    const root = account.rootFolder;

    // Diagnostic: log the full rootFolder so we can see exactly what Thunderbird gives us
    console.log('Smart Mail Cleanup: rootFolder for', account.name, '→', JSON.stringify({
      id:         root?.id,
      accountId:  root?.accountId,
      name:       root?.name,
      path:       root?.path,
      specialUse: root?.specialUse,
      subFolders: root?.subFolders?.length ?? 'undefined',
    }));

    // Also check for a flat .folders array (older API shape)
    if (Array.isArray(account.folders) && account.folders.length > 0) {
      console.log('Smart Mail Cleanup: using account.folders (', account.folders.length, ')');
      for (const f of account.folders) {
        if (!skipSpecial || !skipTypes.includes(f.specialUse)) result.push(f);
      }
      continue;
    }

    // Strategy 1 – getSubFolders with the full rootFolder object (no recursive flag)
    let children = await tryGetSubFolders(root, account);

    // Strategy 2 – fall back to the subFolders property already on the object
    if (!children.length && Array.isArray(root?.subFolders)) {
      console.log('Smart Mail Cleanup: falling back to root.subFolders property');
      children = root.subFolders;
    }

    console.log('Smart Mail Cleanup: top-level children for', account.name, '→', children.length,
                children.map(f => f.name));

    for (const child of children) {
      await recurse(child);
    }
  }

  console.log('Smart Mail Cleanup: total folders collected:', result.length, result.map(f => f.name));
  return result;

  // ── helpers ──────────────────────────────────────────────

  async function tryGetSubFolders(folder, account) {
    // Try the folders API with the folder object
    try {
      if (messenger.folders?.getSubFolders) {
        const children = await messenger.folders.getSubFolders(folder);
        console.log('Smart Mail Cleanup: getSubFolders(folder) →', children.length);
        return children;
      }
    } catch (e) {
      console.warn('Smart Mail Cleanup: getSubFolders(folder) failed:', e.message);
    }

    // Try with just the folder ID
    if (folder?.id) {
      try {
        const children = await messenger.folders.getSubFolders(folder.id);
        console.log('Smart Mail Cleanup: getSubFolders(folder.id) →', children.length);
        return children;
      } catch (e) {
        console.warn('Smart Mail Cleanup: getSubFolders(folder.id) failed:', e.message);
      }
    }

    // Try with accountId + path object
    if (folder?.accountId) {
      try {
        const children = await messenger.folders.getSubFolders(
          { accountId: folder.accountId, path: folder.path ?? '/' }
        );
        console.log('Smart Mail Cleanup: getSubFolders({accountId,path}) →', children.length);
        return children;
      } catch (e) {
        console.warn('Smart Mail Cleanup: getSubFolders({accountId,path}) failed:', e.message);
      }
    }

    return [];
  }

  async function recurse(folder) {
    if (!folder) return;
    const isRoot = !folder.path || folder.path === '/';

    if (!isRoot) {
      if (!skipSpecial || !skipTypes.includes(folder.specialUse)) {
        result.push(folder);
      }
    }

    const children = await tryGetSubFolders(folder, null);
    const fallback  = children.length ? children : (Array.isArray(folder.subFolders) ? folder.subFolders : []);
    for (const child of fallback) {
      await recurse(child);
    }
  }
}

function extractDomain(author) {
  const m = author.match(/[\w.+%-]+@([\w.-]+\.[a-z]{2,})/i);
  if (m) return m[1].toLowerCase();
  // bare address fallback
  const bare = author.replace(/^[^<]*</, '').replace(/>.*$/, '').trim();
  return bare.includes('@') ? bare.split('@')[1]?.toLowerCase() ?? null : null;
}

// ═══════════════════════════════════════════════════════════
// DISCOVER — render table
// ═══════════════════════════════════════════════════════════
function renderDiscoveredSenders() {
  const q    = document.getElementById('discover-search').value.toLowerCase();
  const sort = document.getElementById('discover-sort').value;

  let rows = [...discoveredSenders.entries()]
    .map(([domain, data]) => ({ domain, ...data }))
    .filter(r => !q || r.domain.includes(q));

  switch (sort) {
    case 'new-first': {
      const existingSet = new Set(rules.map(r => r.sender.includes('@') ? r.sender.split('@')[1] : r.sender));
      rows.sort((a, b) => {
        const aIn = existingSet.has(a.domain);
        const bIn = existingSet.has(b.domain);
        if (aIn !== bIn) return aIn ? 1 : -1;   // not-in-rules first
        return a.domain.localeCompare(b.domain); // alphabetical within group
      });
      break;
    }
    case 'count-desc': rows.sort((a, b) => b.count - a.count); break;
    case 'count-asc':  rows.sort((a, b) => a.count - b.count); break;
    case 'name-asc':   rows.sort((a, b) => a.domain.localeCompare(b.domain)); break;
    case 'name-desc':  rows.sort((a, b) => b.domain.localeCompare(a.domain)); break;
  }

  // Build a set of senders already in rules (domains AND addresses)
  const existingSet = new Set(rules.map(r => r.sender));

  const tbody = document.getElementById('discover-tbody');

  tbody.innerHTML = rows.map(r => {
    const inRules = existingSet.has(r.domain);

    // Build sorted address options for this domain
    const addrOptions = `<option value="">— select address —</option>` +
      [...(r.addresses || new Map()).entries()]
      .sort((a, b) => b[1] - a[1])   // most frequent first
      .map(([addr, cnt]) => {
        const inRules = existingSet.has(addr);
        return `<option value="${esc(addr)}" ${inRules ? 'disabled' : ''}>
          ${esc(addr)} (${cnt})${inRules ? ' ✓ in rules' : ''}
        </option>`;
      })
      .join('');

    return `
      <tr class="${inRules ? 'has-rule' : ''}">
        <td class="col-chk">
          <input type="checkbox" class="sender-chk" data-domain="${esc(r.domain)}"
                 ${inRules ? 'disabled title="Already in rules"' : ''}>
        </td>
        <td>
          ${esc(r.domain)}
          ${inRules ? '<span class="badge-existing">✓ in rules</span>' : ''}
          <span class="addr-count-line">
            ${(r.addresses?.size ?? 0)} unique address${(r.addresses?.size ?? 0) !== 1 ? 'es' : ''}
          </span>
          ${r.sample ? `<span class="sample-email">${esc(r.sample)}</span>` : ''}
        </td>
        <td class="col-count"><span class="count-badge">${r.count.toLocaleString()}</span></td>
        <td class="col-match">
          <div class="match-type-cell">
            <select class="disc-match-type match-type-sel" data-domain="${esc(r.domain)}"
                    ${inRules ? 'disabled' : ''}>
              <option value="domain">Domain</option>
              <option value="address">Address</option>
            </select>
            <select class="disc-addr-sel addr-sel" data-domain="${esc(r.domain)}"
                    style="display:none" ${inRules ? 'disabled' : ''}>
              ${addrOptions}
            </select>
          </div>
        </td>
        <td class="col-agechk">
          <input type="checkbox" class="disc-use-age" data-domain="${esc(r.domain)}"
                 checked ${inRules ? 'disabled' : ''}>
        </td>
        <td class="col-age">
          <input type="number" class="age-input disc-age-val" data-domain="${esc(r.domain)}"
                 placeholder="${settings.defaultAgeDays}" min="1" max="3650"
                 ${inRules ? 'disabled' : ''}>
        </td>
      </tr>`;
  }).join('');

  // Wire match-type toggle → show/hide address selector
  tbody.querySelectorAll('.match-type-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const d       = e.target.dataset.domain;
      const addrSel = tbody.querySelector(`.addr-sel[data-domain="${d}"]`);
      if (addrSel) addrSel.style.display = e.target.value === 'address' ? '' : 'none';
    });
  });

  // Wire age-checkbox → enable/disable age input
  tbody.querySelectorAll('.disc-use-age').forEach(cb => {
    cb.addEventListener('change', e => {
      const d  = e.target.dataset.domain;
      const ai = tbody.querySelector(`.disc-age-val[data-domain="${d}"]`);
      if (ai) ai.disabled = !e.target.checked;
    });
  });

  tbody.querySelectorAll('.sender-chk').forEach(cb => {
    cb.addEventListener('change', syncSelectedCount);
  });

  syncSelectedCount();
}

function syncSelectedCount() {
  const n = document.querySelectorAll('.sender-chk:checked').length;
  document.getElementById('selected-count').textContent =
    n === 0 ? '0 selected' : `${n} selected`;
}

function addSelectedToRules() {
  const tbody = document.getElementById('discover-tbody');
  let added = 0;

  tbody.querySelectorAll('.sender-chk:checked').forEach(cb => {
    const domain    = cb.dataset.domain;
    const matchSel  = tbody.querySelector(`.disc-match-type[data-domain="${domain}"]`);
    const addrSel   = tbody.querySelector(`.disc-addr-sel[data-domain="${domain}"]`);
    const useAgeCb  = tbody.querySelector(`.disc-use-age[data-domain="${domain}"]`);
    const ageInp    = tbody.querySelector(`.disc-age-val[data-domain="${domain}"]`);

    const matchType = matchSel?.value ?? 'domain';
    const addrVal   = addrSel?.value ?? '';
    const sender    = matchType === 'address'
      ? (addrVal || domain)   // fall back to domain if placeholder still selected
      : domain;

    // Skip if this exact sender is already in rules
    if (rules.find(r => r.sender === sender)) return;

    rules.push({
      sender,
      matchType,
      enabled: true,
      useAge:  useAgeCb?.checked ?? true,
      ageDays: parseInt(ageInp?.value, 10) || null,
    });
    added++;
  });

  if (added === 0) {
    showStatus('Nothing new to add — select unchecked senders first.', 'warn');
    return;
  }

  persistRules();
  renderRules();
  renderDiscoveredSenders();
  document.getElementById('select-all-senders').checked = false;
  showStatus(`✅ ${added} sender${added !== 1 ? 's' : ''} added to rules.`);
}


// ═══════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════
function setupRun() {
  document.getElementById('btn-dry-run').addEventListener('click', () => executeRun(true));
  document.getElementById('btn-run').addEventListener('click',     () => executeRun(false));
}

function updateRunInfo() {
  const enabled = rules.filter(r => r.enabled).length;
  document.getElementById('enabled-rules-count').textContent = enabled;
  const modeLabels = { trash: 'Trash', found: 'Found folder', permanent: 'Permanent' };
  document.getElementById('run-behavior').textContent =
    modeLabels[settings.deleteMode ?? 'trash'] ?? 'Trash';
  const fc = document.getElementById('run-folder-stat');
  if (fc) fc.textContent = sharedFoldersSelected.length || '—';
}

// Cache the last dry run so Run Now can reuse results without re-scanning
let lastDryRunResult = null;

async function executeRun(dryRun) {
  const enabled = rules.filter(r => r.enabled);
  if (!enabled.length) {
    showStatus('⚠️ No enabled rules — add some in My Rules first.', 'warn');
    return;
  }

  const btnDry = document.getElementById('btn-dry-run');
  const btnRun = document.getElementById('btn-run');

  const setRunning = (which) => {
    btnDry.classList.remove('active-run', 'running');
    btnRun.classList.remove('active-run', 'running');
    btnDry.disabled = true;
    btnRun.disabled = true;
    if (which === 'dry') { btnDry.classList.add('active-run'); btnRun.classList.add('running'); }
    else                 { btnRun.classList.add('active-run'); btnDry.classList.add('running'); }
  };
  const clearRunning = () => {
    btnDry.classList.remove('active-run', 'running');
    btnRun.classList.remove('active-run', 'running');
    updateActionButtons();
  };

  if (dryRun) {
    // Always do a full dry run and cache results
    setRunning('dry');
    lastDryRunResult = null;
    const results = await performRun(enabled);
    lastDryRunResult = results;
    clearRunning();
    showResults(results, true);
    return;
  }

  // Run Now — use cached dry run if available, otherwise scan fresh
  setRunning('run');
  let preview = lastDryRunResult;
  if (!preview) {
    showStatus('Scanning folders…');
    preview = await performRun(enabled);
  }
  clearRunning();

  const total = preview?._uniqueTotal ?? 0;
  if (total === 0) {
    showStatus('No messages currently match your rules.');
    showResults(preview, true);
    return;
  }

  const verbMap = { trash: 'move to Trash', found: 'move to Found folder', permanent: 'permanently delete' };
  const verb    = verbMap[settings.deleteMode ?? 'trash'];
  await showModal(
    '⚠️ Confirm Run',
    `This will ${verb} ${total.toLocaleString()} message${total !== 1 ? 's' : ''} across ${enabled.length} rule${enabled.length !== 1 ? 's' : ''}.\n\nContinue?`,
    async () => {
      setRunning('run');
      // Reuse cached IDs — no re-scan, no re-attachment-check
      const progDiv  = document.getElementById('run-progress');
      const progText = document.getElementById('run-progress-text');
      progDiv.style.display = 'block';
      progText.textContent  = `Processing ${total.toLocaleString()} messages…`;

      const cachedIds = preview._allIds ?? [];
      if (cachedIds.length > 0) {
        await dispatchMessages(cachedIds, null);
      }

      progDiv.style.display = 'none';
      lastDryRunResult      = null;
      clearRunning();
      showResults(preview, false);
    }
  );
}

async function performRun(enabledRules) {
  const progDiv  = document.getElementById('run-progress');
  const progText = document.getElementById('run-progress-text');
  progDiv.style.display = 'block';
  document.getElementById('run-results').style.display = 'none';

  const fill = document.getElementById('run-progress-fill');
  fill.style.animation = '';
  fill.style.width = '25%';

  // Pre-compute cutoffs once per rule
  const ruleMeta = enabledRules.map(rule => ({
    rule,
    senderLower:      rule.sender.toLowerCase(),
    matchType:        rule.matchType ?? 'domain',
    cutoff:           getCutoff(rule),
    skipIfAttachment: rule.skipIfAttachment ?? false,
    ids:              new Set(),
    attachCheckIds:   new Set(),   // IDs needing post-scan attachment check
    msgDetails:       [],
  }));

  // Pre-compute keyword list for fast subject checking
  const excludeKeywords = (settings.excludeKeywords ?? []).map(k => k.toLowerCase());
  const anyAttachRules  = ruleMeta.some(m => m.skipIfAttachment);

  // ── Single pass: read each folder once, match ALL rules simultaneously ──
  if (!sharedFoldersSelected.length) {
    progDiv.style.display = 'none';
    await showModal(
      '📂 No folders selected',
      'Please use the "Load Folders" button at the top of the page to select which folders to scan, then try again.',
      null
    );
    return [];
  }
  const allFolders = sharedFoldersSelected;
  const total      = allFolders.length;

  for (let fi = 0; fi < total; fi++) {
    const folder = allFolders[fi];
    const pct    = Math.round(((fi + 1) / total) * 100);
    fill.style.animation = 'none';
    fill.style.width     = pct + '%';
    progText.textContent = `Scanning folder ${fi + 1}/${total}: "${folder.name}"`;

    try {
      let page = await messenger.messages.list(folder.id);
      while (page) {
        for (const msg of page.messages) {
          if (!msg.author) continue;
          const authorLower = msg.author.toLowerCase();

          // Global keyword exclude
          if (excludeKeywords.length) {
            const subjectLower = (msg.subject ?? '').toLowerCase();
            if (excludeKeywords.some(kw => subjectLower.includes(kw))) continue;
          }

          for (const meta of ruleMeta) {
            if (!messageMatchesRule(authorLower, meta)) continue;
            if (meta.cutoff && msg.date >= meta.cutoff) continue;
            meta.ids.add(msg.id);
            // Flag for post-scan attachment check instead of checking inline
            if (meta.skipIfAttachment) meta.attachCheckIds.add(msg.id);
            if (meta.msgDetails && meta.msgDetails.length < 2000) {
              meta.msgDetails.push({
                id:      msg.id,
                subject: msg.subject || '(no subject)',
                date:    msg.date,
                folder:  folder.name,
              });
            }
          }
        }
        page = page.id ? await messenger.messages.continueList(page.id) : null;
      }
    } catch (e) {
      console.warn(`Smart Mail Cleanup: skipping "${folder.name}":`, e.message);
    }
  }

  // ── Post-scan attachment check ──
  // messages.list() doesn't expose attachment info in MV3.
  // Call listAttachments() only for messages matched by attachment-filtered rules.
  if (anyAttachRules) {
    // Collect all IDs needing a check (across all attachment-filtered rules)
    const allAttachCheckIds = new Set(
      ruleMeta.filter(m => m.skipIfAttachment).flatMap(m => [...m.attachCheckIds])
    );

    if (allAttachCheckIds.size > 0) {
      progText.textContent =
        `Checking ${allAttachCheckIds.size.toLocaleString()} messages for attachments…`;

      // Build a set of IDs that actually have attachments
      const hasAttachmentSet = new Set();
      let checked = 0;
      for (const msgId of allAttachCheckIds) {
        try {
          const attachments = await messenger.messages.listAttachments(msgId);
          if (attachments.length > 0) hasAttachmentSet.add(msgId);
        } catch (e) {
          // If we can't check, err on the side of keeping the message
        }
        checked++;
        if (checked % 20 === 0) {
          progText.textContent =
            `Checking attachments… ${checked}/${allAttachCheckIds.size}`;
        }
      }

      // Remove attachment-having messages from each attachment-filtered rule
      for (const meta of ruleMeta) {
        if (!meta.skipIfAttachment) continue;
        for (const id of hasAttachmentSet) {
          meta.ids.delete(id);
          // Also remove from msgDetails if present
          if (meta.msgDetails) {
            const idx = meta.msgDetails.findIndex(m => m.id === id);
            if (idx !== -1) meta.msgDetails.splice(idx, 1);
          }
        }
      }

      console.log(`Smart Mail Cleanup: attachment check — ${hasAttachmentSet.size} of ${allAttachCheckIds.size} messages have attachments and were skipped`);
    }
  }

  // Delete/move is now handled by executeRun using cached IDs — no action here

  progDiv.style.display = 'none';
  fill.style.animation  = '';
  fill.style.width      = '25%';

  const allMatchedIds = new Set(ruleMeta.flatMap(m => [...m.ids]));
  const out = ruleMeta.map(m => ({
    sender:     m.rule.sender,
    count:      m.ids.size,
    msgDetails: m.msgDetails ?? [],
  }));
  out._uniqueTotal = allMatchedIds.size;
  out._allIds      = [...allMatchedIds];   // cached for Run Now to reuse without re-scanning
  return out;
}

// Match a message author against a rule, respecting matchType.
function messageMatchesRule(authorLower, meta) {
  if (meta.matchType === 'address') {
    const addr = extractAddress(authorLower);
    return addr === meta.senderLower;
  }
  return senderMatchesDomain(authorLower, meta.senderLower);
}

// Domain match with boundary anchoring.
function senderMatchesDomain(authorLower, senderLower) {
  return authorLower.includes('@' + senderLower) ||
         authorLower.includes('.' + senderLower);
}

// Extract raw email address from author string.
// Handles "Display Name <email@domain.com>" and bare addresses.
function extractAddress(author) {
  if (!author) return null;
  const m = author.match(/<([\w.+%-]+@[\w.-]+\.[a-z]{2,})>/i);
  if (m) return m[1].toLowerCase();
  const bare = author.trim();
  return (bare.includes('@') && !bare.includes(' ')) ? bare.toLowerCase() : null;
}

// Extract the root domain for sorting purposes.
// "global.godragy.com" → "dragy.com"
// "alerts@chase.com"   → "chase.com"
// "em.bjs.com"         → "bjs.com"
function rootDomain(sender) {
  // Strip address prefix if present
  const domain = sender.includes('@') ? sender.split('@')[1] : sender;
  if (!domain) return sender.toLowerCase();
  const parts = domain.toLowerCase().split('.');
  // Return last two segments (handles .com, .org, .net, .ai, etc.)
  return parts.length >= 2 ? parts.slice(-2).join('.') : domain.toLowerCase();
}

function getCutoff(rule) {
  if (!rule.useAge) return null;
  const days = rule.ageDays ?? settings.defaultAgeDays ?? 30;
  return new Date(Date.now() - days * 86_400_000);
}

// Route messages to trash, Found folder, or permanent delete based on settings.deleteMode
async function dispatchMessages(ids, ruleMeta) {
  const mode = settings.deleteMode ?? 'trash';

  if (mode === 'permanent') {
    await deleteInBatches(ids, true);
    return;
  }

  if (mode === 'trash') {
    await deleteInBatches(ids, false);
    return;
  }

  // 'found' mode — move to per-account Found folder
  // Group message IDs by account
  const byAccount = new Map();
  for (const msgId of ids) {
    try {
      const msg = await messenger.messages.get(msgId);
      const accountId = msg.folder?.accountId;
      if (!accountId) continue;
      if (!byAccount.has(accountId)) byAccount.set(accountId, []);
      byAccount.get(accountId).push(msgId);
    } catch (e) {
      console.warn(`Smart Mail Cleanup: could not get message ${msgId}:`, e.message);
    }
  }

  for (const [accountId, msgIds] of byAccount) {
    const foundFolder = await getOrCreateFoundFolder(accountId);
    if (!foundFolder) {
      // ABORT — do not fall back to delete. Show a clear error instead.
      const msg = `Could not create or find the "Found" folder in account ${accountId}.\n\nPlease create a folder named "Found" manually in Thunderbird (right-click your account → New Folder), then run again.`;
      showStatus('❌ Found folder unavailable — messages were NOT moved. See My Rules tab.', 'error');
      await showModal('❌ Found Folder Error', msg, null);
      return;
    }
    await moveInBatches(msgIds, foundFolder);
  }
}

// Get the Found folder for an account, creating it if it doesn't exist.
async function getOrCreateFoundFolder(accountId) {
  const accounts = await messenger.accounts.list();
  const account  = accounts.find(a => a.id === accountId);
  if (!account) return null;

  // Check if Found already exists at the root level
  try {
    const rootChildren = await messenger.folders.getSubFolders(account.rootFolder.id);
    const existing = rootChildren.find(f => f.name === 'Found');
    if (existing) return existing;
  } catch (e) {
    console.warn('Smart Mail Cleanup: error listing root folders:', e.message);
  }

  // Try creating with root folder ID (same format that works for getSubFolders)
  const createAttempts = [
    () => messenger.folders.create(account.rootFolder.id, 'Found'),
    () => messenger.folders.create({ accountId, name: 'Found' }),
    () => messenger.folders.create(account.rootFolder, 'Found'),
  ];

  for (const attempt of createAttempts) {
    try {
      const newFolder = await attempt();
      console.log(`Smart Mail Cleanup: created Found folder in account ${account.name}`);
      return newFolder;
    } catch (e) {
      console.warn(`Smart Mail Cleanup: create attempt failed:`, e.message);
    }
  }

  console.warn('Smart Mail Cleanup: all folder creation attempts failed');
  return null;
}

async function moveInBatches(ids, destFolder, batchSize = 100) {
  // MV3: messages.move needs the folder ID string, not the folder object
  const destId = typeof destFolder === 'string' ? destFolder : destFolder.id;
  for (let i = 0; i < ids.length; i += batchSize) {
    await messenger.messages.move(ids.slice(i, i + batchSize), destId);
  }
}


async function deleteInBatches(ids, skipTrash, batchSize = 100) {
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    if (skipTrash) {
      // Permanent delete — MV3 requires options object
      await messenger.messages.delete(batch, { skipTrash: true });
    } else {
      // Move to trash — no options argument
      await messenger.messages.delete(batch);
    }
  }
}

function showResults(results, dryRun) {
  const perRuleTotal = results.reduce((s, r) => s + r.count, 0);
  const uniqueTotal  = results._uniqueTotal ?? perRuleTotal;
  const nonZero      = results.filter(r => r.count > 0);

  const resultsDiv = document.getElementById('run-results');
  const summary    = document.getElementById('results-summary');
  const title      = document.getElementById('results-title');
  const tbody      = document.getElementById('results-tbody');

  title.textContent = dryRun ? '🔍 Dry Run Results' : '✅ Run Complete';

  if (uniqueTotal === 0) {
    summary.className   = 'results-summary empty';
    summary.textContent = 'No messages matched any enabled rules.';
  } else {
    const dryVerbs  = { trash: 'would be moved to Trash', found: 'would be moved to Found folder', permanent: 'would be permanently deleted' };
    const doneVerbs = { trash: 'moved to Trash', found: 'moved to Found folder', permanent: 'permanently deleted' };
    const mode = settings.deleteMode ?? 'trash';
    const verb = dryRun ? dryVerbs[mode] : doneVerbs[mode];
    summary.className   = `results-summary ${dryRun ? 'dry-run' : 'ok'}`;
    summary.textContent =
      `${uniqueTotal.toLocaleString()} unique message${uniqueTotal !== 1 ? 's' : ''} ${verb} across ${nonZero.length} sender${nonZero.length !== 1 ? 's' : ''}.`;
    if (dryRun) {
      summary.textContent += ' Click a sender to see its messages.';
    }
  }

  // Build rows — each sender gets a data row + a hidden detail row
  tbody.innerHTML = results
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r, idx) => {
      const hasDetails = dryRun && r.msgDetails?.length > 0;
      const MAX_SHOW   = 500;
      const detailRows = hasDetails
        ? r.msgDetails
            .sort((a, b) => b.date - a.date)
            .slice(0, MAX_SHOW)
            .map(m => `
              <tr class="msg-detail-row">
                <td class="msg-subject">${esc(m.subject)}</td>
                <td class="msg-date">${formatDate(m.date)}</td>
                <td class="msg-folder">${esc(m.folder)}</td>
                <td class="msg-view">
                  <button class="btn-view-msg" data-msg-id="${m.id}" title="Open message in Thunderbird">📬 View</button>
                </td>
              </tr>`).join('')
        : '';

      const overflow = hasDetails && r.msgDetails.length > MAX_SHOW
        ? `<tr class="msg-detail-row msg-overflow">
             <td colspan="4">Showing first ${MAX_SHOW} of ${r.msgDetails.length.toLocaleString()} messages</td>
           </tr>`
        : '';

      return `
        <tr class="result-sender-row ${hasDetails ? 'expandable' : ''}" data-idx="${idx}">
          <td>${esc(r.sender)}</td>
          <td class="col-count"><span class="count-badge">${r.count.toLocaleString()}</span></td>
          <td class="col-expand">${hasDetails ? '<span class="expand-icon">▶</span>' : ''}</td>
        </tr>
        <tr class="msg-detail-container" id="detail-${idx}" style="display:none">
          <td colspan="3" style="padding:0">
            <table class="msg-detail-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th class="msg-date">Date</th>
                  <th class="msg-folder">Folder</th>
                  <th class="msg-view"></th>
                </tr>
              </thead>
              <tbody>${detailRows}${overflow}</tbody>
            </table>
          </td>
        </tr>`;
    }).join('');

  // Wire expand/collapse on sender rows
  tbody.querySelectorAll('.result-sender-row.expandable').forEach(row => {
    row.addEventListener('click', () => {
      const idx       = row.dataset.idx;
      const detail    = document.getElementById(`detail-${idx}`);
      const icon      = row.querySelector('.expand-icon');
      const isOpen    = detail.style.display !== 'none';
      detail.style.display = isOpen ? 'none' : '';
      if (icon) icon.textContent = isOpen ? '▶' : '▼';
    });
  });

  // Wire View buttons
  tbody.querySelectorAll('.btn-view-msg').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();   // don't toggle the row expand
      const msgId = parseInt(btn.dataset.msgId, 10);
      try {
        await messenger.messageDisplay.open({ messageId: msgId });
      } catch (err) {
        showStatus(`❌ Could not open message: ${err.message}`, 'error');
      }
    });
  });

  resultsDiv.style.display = 'block';

  const doneVerbs = { trash: 'moved to Trash', found: 'moved to Found folder', permanent: 'permanently deleted' };
  const doneVerb  = doneVerbs[settings.deleteMode ?? 'trash'];
  if (!dryRun) {
    showStatus(`✅ Done — ${uniqueTotal.toLocaleString()} messages ${doneVerb}.`);
  } else {
    showStatus(`🔍 Dry run — ${uniqueTotal.toLocaleString()} unique messages would be affected. Click a sender to expand.`);
  }
}

function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
function setProgressText(msg) {
  document.getElementById('progress-text').textContent = msg;
}

function showStatus(msg, type = 'info') {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.style.opacity = '1';
  const bg = type === 'error' ? '#7f1d1d' : type === 'warn' ? '#78350f' : '#0f172a';
  bar.style.background = bg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { bar.style.opacity = '.35'; }, 5000);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Modal returns a Promise; resolves after user clicks either button.
function showModal(title, body, onConfirm) {
  return new Promise(resolve => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent  = body;
    document.getElementById('modal-overlay').style.display = 'flex';

    // Clone nodes to remove any previous listeners
    const oldConfirm = document.getElementById('modal-confirm');
    const oldCancel  = document.getElementById('modal-cancel');
    const newConfirm = oldConfirm.cloneNode(true);
    const newCancel  = oldCancel.cloneNode(true);
    oldConfirm.replaceWith(newConfirm);
    oldCancel.replaceWith(newCancel);

    const close = () => {
      document.getElementById('modal-overlay').style.display = 'none';
      resolve();
    };

    newConfirm.addEventListener('click', async () => { close(); if (onConfirm) await onConfirm(); });
    newCancel.addEventListener('click',  close);
  });
}
