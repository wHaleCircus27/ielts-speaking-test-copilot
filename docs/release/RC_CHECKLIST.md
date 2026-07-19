# 0.1.0-rc.1 Release Checklist

Unchecked items are release blockers. This checklist must be completed with evidence from the target Apple Silicon macOS device.

## Repository Gates

- [x] `pnpm verify` passes from a fresh clone with the frozen lockfile.
- [x] `dependency-audit` passes with no high/critical finding and only active, unexpired exceptions.
- [x] `secret-scan` passes against complete Git history with redaction enabled.
- [ ] GitHub `main` requires `verify`, `dependency-audit`, and `secret-scan`.

## Bundle

- [x] `.app` executable is arm64 and minimum macOS version is 15.0.
- [x] Version and bundle identifier match release manifests.
- [x] Ad-hoc signature passes `codesign --verify --deep --strict`.
- [x] LICENSE, NOTICE, THIRD_PARTY_NOTICES, and application icons are present in the bundle.
- [x] Bundle ZIP SHA-256 is recorded in sanitized evidence.

## Clean Account Smoke

- [ ] First launch succeeds with all cloud services disabled.
- [ ] Cloud disclosure is accepted before a service can be enabled.
- [ ] Configuration persists with directory mode `0700`, file mode `0600`, and no plaintext keys.
- [ ] All three themes survive restart.
- [ ] MP4, MP3, M4A, and WAV convert to 16 kHz, 16-bit, mono PCM WAV.
- [ ] Generated WAV playback and word seeking work through the scoped asset protocol.
- [ ] History and corpus remain accessible at 960px and 1200px window widths.
- [ ] Two media history records never swap audio; a legacy record without `audioPath` shows unavailable.
- [ ] Individual history deletion removes only the owned WAV.

## Upgrade Account Smoke

- [ ] Baseline app creates synthetic history through a loopback endpoint.
- [ ] RC migrates legacy configuration keys to Keychain without plaintext backups.
- [ ] Existing history and teacher case identifiers/content remain readable.
- [ ] Database error details from older builds are sanitized.
- [ ] Upgrade restart preserves configuration, history, corpus, and owned media associations.

## Real Services

- [x] DeepSeek synthetic text grading passes and failed retry preserves the draft.
- [ ] Azure assessment of locally generated synthetic speech longer than 35 seconds passes.
- [ ] Azure first/middle/last word seeking is within 0.5 seconds and playback highlighting is correct.
- [x] Zhipu `embedding-3` returns 1024 dimensions and threshold/cache checks pass.
- [x] Evidence contains only whitelisted summaries and passes `pnpm evidence:verify`.

## Recovery and Decision

- [ ] Backup is created with local restricted permissions.
- [ ] Rollback exercise restores the previous app and readable local data.
- [ ] All 21 RH tasks have an implementation commit and acceptance evidence.
- [ ] Go/No-Go is reviewed. Any unchecked item keeps the decision at No-Go.
