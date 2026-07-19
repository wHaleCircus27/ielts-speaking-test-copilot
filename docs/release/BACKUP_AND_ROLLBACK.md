# Backup and Rollback

These steps are for a local Apple Silicon macOS test account. Stop the app before backup or rollback. Keep backups on encrypted local storage with permissions restricted to the current user; never upload them.

## Backup

1. Quit IELTS Speaking Test Copilot and confirm no process remains.
2. Set a restrictive shell mask: `umask 077`.
3. Create a timestamped local backup directory.
4. Copy these directories when present:
   - `~/Library/Application Support/com.local.ielts-speaking-test-copilot`
   - `~/Library/WebKit/com.local.ielts-speaking-test-copilot`
5. Preserve the previously installed `.app` beside the backup.
6. Verify backup directories are mode `0700` and regular files are not group/world accessible.

Do not export Keychain credentials. After rollback, enter provider keys again if the previous build cannot read the new Keychain entries.

## Rollback

1. Quit the RC app.
2. Move the RC `.app` into a timestamped quarantine directory; do not delete it.
3. Restore the previously preserved `.app`.
4. Move the current Application Support and WebKit directories into a new timestamped quarantine directory. Never overwrite or delete the only current copy.
5. Restore the complete Application Support and WebKit directories from the pre-upgrade backup. The app does not create a separate database migration backup.
6. Confirm restored configuration JSON contains no API key fields with non-null values.
7. Launch the previous app and verify history records and teacher cases are readable.
8. Record the exercise outcome in the RC evidence file without local paths or user content.

Rollback is complete only after the previous build starts and representative history/corpus records are readable.
