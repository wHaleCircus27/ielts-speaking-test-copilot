# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog and the project uses Semantic Versioning.

## [0.1.0-rc.1] - 2026-07-19

### Added

- Deterministic offline release verification, ARM64 CI, dependency auditing, and full-history secret scanning.
- Per-record generated WAV ownership, media cancellation, resource limits, orphan reconciliation, and capacity enforcement.
- macOS Keychain credential storage and versioned cloud data disclosure controls.
- Internal `.app` bundle verification, smoke-test checklists, and backup/rollback procedures.

### Changed

- Generated media now lives in the application data directory and is exposed only through a scoped Tauri asset protocol.
- DeepSeek and Zhipu endpoints, Azure regions, and credential bindings are validated before any cloud request.
- The history sidebar becomes available at the 960px minimum window width.

### Fixed

- Failed text grading and failed history persistence no longer clear the user's draft.
- Starting a new session resets workspace state and ignores late results from the previous session.
- Historical playback uses only the selected record's WAV and never falls back to the latest transcode.

### Security

- API keys are migrated out of plaintext configuration into macOS Keychain.
- Public errors omit response bodies, request URLs, input text, and underlying implementation details.
- Speech SDK `ws` is overridden to 8.21.0. The remaining `uuid@9` moderate advisory has a reviewed, expiring exception.

### Known Limitations

- This internal RC supports Apple Silicon on macOS 15 or later only.
- The app is ad-hoc signed and is not notarized; there is no DMG, automatic update, or Intel build.
- Waveform visualization is deferred; transcript timestamps and standard audio controls remain available.
- Cloud grading and speech assessment require user-supplied provider credentials and explicit data disclosure acceptance.
