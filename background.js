'use strict';

// Open the options page when the toolbar button is clicked
messenger.action.onClicked.addListener(() => {
  messenger.runtime.openOptionsPage();
});

// Auto-run rules when Thunderbird starts (if the user enabled this setting)
messenger.runtime.onStartup.addListener(async () => {
  const stored = await messenger.storage.local.get(['rules', 'settings', 'selectedFolderIds']);
  const { rules, settings } = stored;
  if (!settings?.autoRunOnStartup || !rules?.length) return;

  const enabledRules = rules.filter(r => r.enabled);
  if (!enabledRules.length) return;

  console.log(`Smart Mail Cleanup: auto-run starting with ${enabledRules.length} rules`);

  // Use persisted folder selection; fall back to all folders
  const allFolders = await getAllFolders(stored.selectedFolderIds ?? []);

  // Pre-compute rule metadata for single-pass scan
  const ruleMeta = enabledRules.map(rule => ({
    rule,
    senderLower:      rule.sender.toLowerCase(),
    matchType:        rule.matchType ?? 'domain',
    cutoff:           getCutoff(rule, settings),
    skipIfAttachment: rule.skipIfAttachment ?? false,
    ids:              new Set(),
  }));

  const excludeKeywords = (settings.excludeKeywords ?? []).map(k => k.toLowerCase());

  for (const folder of allFolders) {
    try {
      let page = await messenger.messages.list(folder.id);
      while (page) {
        for (const msg of page.messages) {
          if (!msg.author) continue;
          const authorLower = msg.author.toLowerCase();

          if (excludeKeywords.length) {
            const subjectLower = (msg.subject ?? '').toLowerCase();
            if (excludeKeywords.some(kw => subjectLower.includes(kw))) continue;
          }

          for (const meta of ruleMeta) {
            if (!bgMessageMatchesRule(authorLower, meta)) continue;
            if (meta.cutoff && msg.date >= meta.cutoff) continue;
            if (meta.skipIfAttachment && (msg.hasAttachment || (msg.attachmentCount ?? 0) > 0)) continue;
            meta.ids.add(msg.id);
          }
        }
        page = page.id ? await messenger.messages.continueList(page.id) : null;
      }
    } catch (e) {
      console.warn(`Smart Mail Cleanup: skipping folder "${folder.name}"`, e.message);
    }
  }

  const toDeleteAll = [...new Set(ruleMeta.flatMap(m => [...m.ids]))];
  if (toDeleteAll.length > 0) {
    const mode = settings.deleteMode ?? (settings.moveToTrash ? 'trash' : 'permanent');
    // Found folder mode not supported in background auto-run (no UI context) — fall back to trash
    const skipTrash = mode === 'permanent';
    await deleteInBatches(toDeleteAll, skipTrash);
    console.log(`Smart Mail Cleanup: auto-run removed ${toDeleteAll.length} messages`);
  }
});

// ─── helpers ────────────────────────────────────────────────

async function getAllFolders(selectedIds) {
  const skipTypes  = ['trash', 'junk', 'sent', 'outbox', 'drafts', 'templates'];
  const savedSet   = new Set(selectedIds);
  const accounts   = await messenger.accounts.list();
  const allFolders = [];

  for (const account of accounts) {
    await recurse(account.rootFolder);
  }

  // If user has a saved selection, filter to it; otherwise return all
  return savedSet.size ? allFolders.filter(f => savedSet.has(f.id)) : allFolders;

  async function recurse(folder) {
    if (!folder) return;
    const isRoot = !folder.path || folder.path === '/';
    if (!isRoot && !skipTypes.includes(folder.specialUse)) allFolders.push(folder);

    let children = [];
    try {
      if (messenger.folders?.getSubFolders) {
        children = await messenger.folders.getSubFolders(folder.id);
      } else {
        children = Array.isArray(folder.subFolders) ? folder.subFolders : [];
      }
    } catch (e) {
      children = Array.isArray(folder.subFolders) ? folder.subFolders : [];
    }
    for (const child of children) await recurse(child);
  }
}

function bgMessageMatchesRule(authorLower, meta) {
  if (meta.matchType === 'address') {
    const m    = authorLower.match(/<([\w.+%-]+@[\w.-]+\.[a-z]{2,})>/i);
    const addr = m ? m[1].toLowerCase() : (authorLower.includes('@') ? authorLower.trim() : null);
    return addr === meta.senderLower;
  }
  return authorLower.includes('@' + meta.senderLower) ||
         authorLower.includes('.' + meta.senderLower);
}

function getCutoff(rule, settings) {
  if (!rule.useAge) return null;
  const days = rule.ageDays ?? settings?.defaultAgeDays ?? 30;
  return new Date(Date.now() - days * 86_400_000);
}

async function deleteInBatches(ids, skipTrash, batchSize = 100) {
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    if (skipTrash) {
      await messenger.messages.delete(batch, { skipTrash: true });
    } else {
      await messenger.messages.delete(batch);
    }
  }
}

