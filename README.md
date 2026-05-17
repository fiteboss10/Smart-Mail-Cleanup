# Smart Mail Cleanup

A Thunderbird extension for bulk-moving or deleting emails by sender domain or specific address.

**Version:** 1.0.0  
**Requires:** Thunderbird 128 or later  
**Author:** B. Moody  
**License:** MIT  
**Repository:** https://github.com/fiteboss10/smart-mail-cleanup  
**ATN Listing:** https://addons.thunderbird.net/thunderbird/addon/smart-mail-cleanup/

---

## Features

- Scan selected folders to discover unique senders with message and address counts
- Match by domain (`chase.com`) or specific address (`alerts@chase.com`)
- Age-based rules — only act on messages older than N days (default for new rules)
- Attachment filter — skip messages that have attachments (📎 per rule)
- Global keyword exclude list — protect any message whose subject matches
- Three action modes: Move to Trash · Move to Found folder (per account) · Permanently delete
- Dry Run with expandable per-sender message detail and in-app viewer
- Run Now reuses cached Dry Run results — no second scan
- Single-pass scanning — all rules evaluated per message in one loop
- Rules sorted by root domain; exported/imported as JSON
- First-use disclaimer acknowledgment modal
- Auto-run on Thunderbird startup (optional)
- All data stored locally; nothing transmitted externally

---

## Installation (Development / Testing)

1. In Thunderbird: **Tools → Add-on Manager**
2. Click the ⚙️ gear icon → **Debug Add-ons**
3. Click **Load Temporary Add-on…**
4. Navigate to the unzipped folder and select **manifest.json**

---

## Packaging

```bash
cd smart-mail-cleanup
zip -r ../smart-mail-cleanup-1.0.0.xpi manifest.json background.js options.html options.css options.js icons/ README.md PRIVACY.md DISCLAIMER.md
```

Source zip for ATN submission:
```bash
zip -r ../smart-mail-cleanup-1.0.0-source.zip manifest.json background.js options.html options.css options.js icons/ README.md PRIVACY.md DISCLAIMER.md
```

---

## Publishing to addons.thunderbird.net (ATN)

### Pre-Submission Checklist

- [ ] GitHub repository created at `https://github.com/fiteboss10/smart-mail-cleanup`
- [ ] All source files pushed to the repository
- [ ] `PRIVACY.md` accessible at `https://github.com/fiteboss10/smart-mail-cleanup/blob/main/PRIVACY.md`
- [ ] Icons confirmed: `icons/icon-32.png`, `icons/icon-64.png`, `icons/icon-128.png`
- [ ] Extension tested with temporary install — Dry Run and Run Now both working
- [ ] Disclaimer modal appears on first use and does not appear again after acceptance
- [ ] Both `.xpi` and source `.zip` built from the same source

### Submission Steps

**1. Create a developer account**  
Go to https://addons.thunderbird.net → Register (or log in with your Mozilla account).

**2. Start a new submission**  
Click your username → **Developer Hub** → **Submit a New Add-on** → **On this site** → Continue.

**3. Upload the XPI**  
Select **Thunderbird** as the application. Upload `smart-mail-cleanup-1.0.0.xpi`. ATN will validate the manifest.

**4. Fill in the listing**

**Name:** Smart Mail Cleanup

**Summary (max 250 chars):**
```
Bulk-clean your inbox: scan for senders, build rules, preview with Dry Run, then move to Trash or a Found folder. Supports domain/address matching, age filters, and attachment exclusions.
```

**Description:**
```
Smart Mail Cleanup helps you take back control of a cluttered inbox by letting you build rules that identify unwanted email by sender domain or specific address, then act on them in bulk.

Features:
• Scan selected folders to discover unique senders with message and address counts
• Match by entire domain (e.g. promotions.com) or one specific address
• Age-based rules: only act on messages older than N days (on by default)
• Attachment filter: skip (keep) messages that have attachments, per rule
• Global keyword exclusion: protect any message whose subject contains words like "invoice" or "receipt"
• Three action modes: Move to Trash (recoverable), Move to Found folder (for review), or Permanently delete
• Dry Run shows exactly what would be affected — click any sender to see individual messages and open them in Thunderbird
• Run Now reuses the Dry Run scan — no second pass needed
• All rules evaluated in a single folder pass — fast even with 200+ rules
• Rules sorted alphabetically by root domain; export/import as JSON
• Optional auto-run on Thunderbird startup

First-use disclaimer acknowledgment required. Your rules are stored locally and never transmitted anywhere.

DISCLAIMER: This extension is provided as-is without warranty. Always use Dry Run before committing to permanent deletion. The author is not liable for unintended data loss. See DISCLAIMER.md for full terms.
```

**Categories:** Filters (primary), Folders & Tags

**Privacy Policy URL:**  
`https://github.com/fiteboss10/smart-mail-cleanup/blob/main/PRIVACY.md`

**Support URL:**  
`https://github.com/fiteboss10/smart-mail-cleanup/issues`

**Homepage URL:**  
`https://github.com/fiteboss10/smart-mail-cleanup`

**5. Upload source code**  
ATN requires source for extensions that touch messages. Upload `smart-mail-cleanup-1.0.0-source.zip` when prompted. Add a note:

```
Standard HTML/CSS/JS WebExtension. No build step required — source files are identical to XPI contents. Entry points: manifest.json → background.js (auto-run) and options.html/options.js (UI).
```

**6. Screenshots**  
ATN recommends at least one screenshot (1280×800 or 2560×1600). Suggested shots:
- Discover Senders tab with a populated sender list
- My Rules tab showing a mix of domain and address rules
- Dry Run results with an expanded sender showing individual messages

**7. Submit**  
Click **Submit Version**. Extensions that move or delete email typically receive a manual review (a few days to 2 weeks). Reviewers will read the source code and may ask questions via the ATN developer hub.

**8. After approval**  
ATN signs the extension. Download the signed XPI from your developer page. Update version to `1.0.0` in your Git tags.

---

## Version History

| Version | Notes |
|---------|-------|
| 1.0.0   | First public release. Formal disclaimer + acknowledgment modal, full Help tab rewrite, About section, 128px icon, PRIVACY.md, DISCLAIMER.md |
| 0.4.12  | Logo added to header; real icons replacing placeholders |
| 0.4.11  | Age-Based checked by default on new rules |
| 0.4.10  | Submission prep: extension ID, icons, updated help, README |
| 0.4.9   | Cached dry run results; fixed messages.move API |
| 0.4.8   | Fixed messages.delete API; Found folder abort on failure |
| 0.4.7   | Fixed messages.move argument type |
| 0.4.6   | Delete mode applies immediately without Save |
| 0.4.5   | Fixed syntax error in deleteInBatches |
| 0.4.4   | Move to Found folder mode (per account) |
| 0.4.3   | Attachment filtering via listAttachments() post-scan |
| 0.4.2   | Diagnostic build for attachment API investigation |
| 0.4.0   | Auto-load folders on open; root-domain sort; disabled buttons until folders selected |
| 0.3.x   | Core scan/run/rules/discover engine; iterative bug fixes |

---

## License

MIT — free to use, modify, and distribute.

See [DISCLAIMER.md](DISCLAIMER.md) and [PRIVACY.md](PRIVACY.md) for full terms.
