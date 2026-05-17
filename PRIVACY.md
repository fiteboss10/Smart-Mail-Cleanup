# Privacy Policy — Smart Mail Cleanup

**Last updated:** May 2026

## Summary

Smart Mail Cleanup does not collect, transmit, or share any personal data. Everything stays on your computer.

## Data Storage

The extension stores the following data locally using Thunderbird's built-in storage API (`messenger.storage.local`):

- **Rules** — the sender domains and email addresses you have added, along with their settings (age, match type, attachment filter)
- **Settings** — your preferences (default age, delete mode, exclude keywords, auto-run)
- **Folder selection** — which folders you have chosen to scan
- **Disclaimer acceptance** — a boolean flag recording that you have accepted the terms of use

All of this data is stored locally on your device only. It is never sent to any server, third party, or external service.

## Data Access

The extension reads email message headers (sender, subject, date, folder) to apply your rules. It does not read message bodies. It does not store any message content.

## Permissions

The extension requests the following Thunderbird permissions:

| Permission | Purpose |
|------------|---------|
| `accountsRead` | List your email accounts to find folders |
| `accountsFolders` | Enumerate subfolders within accounts |
| `messagesRead` | Read message headers to match against your rules |
| `messagesDelete` | Move messages to Trash or permanently delete them |
| `messagesMove` | Move messages to the Found folder |
| `storage` | Save your rules and settings locally |

No other permissions are requested or used.

## Third Parties

This extension does not communicate with any third-party service, analytics platform, advertising network, or remote server of any kind.

## Contact

For questions about this privacy policy, open an issue at:
https://github.com/fiteboss10/smart-mail-cleanup/issues
