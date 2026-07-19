# Real Service Acceptance

Run these checks only on the target local macOS account. Credentials may come from Keychain, environment variables, or ignored `test-resource/` files. Never print, screenshot, commit, or upload a key, token, Authorization header, input text, transcript, absolute path, vector, or response body.

## DeepSeek

- Use synthetic IELTS text with no student data.
- Confirm `/models` is reachable and includes the configured model.
- Confirm overall band, four sub-scores, feedback, corrections, and model answer are present; every score is within 0-9.
- Confirm a successful record persists and a failed retry retains all input fields.

## Azure Speech

- Generate synthetic English speech longer than 35 seconds locally and convert it to 16 kHz, 16-bit, mono WAV.
- Confirm token preflight is 2xx without recording the token.
- Run continuous pronunciation assessment from the packaged app within the calculated timeout.
- Confirm recognized word count is nonzero, then manually check first/middle/last word seeking and playback highlighting.
- Restart and confirm the same history record retains its own audio.

## Zhipu

- Use three synthetic samples with `embedding-3` and 1024 dimensions.
- Record average, p50, and p95 latency only.
- Confirm included matches score at least 0.45, near misses score below 0.45, and Top-K is at most 3.
- Confirm the first lookup reports network and a repeated lookup reports cache.

Write only whitelisted summaries to `docs/release/evidence/0.1.0-rc.1.json`, then run `pnpm evidence:verify` and the full-history secret scan before committing evidence.

## Local commands

Validate all acceptance scripts without reading credentials, opening samples, or using the network:

```bash
pnpm acceptance:safety-test
pnpm acceptance:dry-run
```

Generate the local Azure sample first, then run each real service check from the target macOS account:

```bash
pnpm azure:generate-speech
pnpm deepseek:acceptance --model deepseek-v4-flash
pnpm azure:speech-preflight --region eastasia
pnpm zhipu:embedding-benchmark --model embedding-3 --dimensions 1024
```

Successful and failed real runs write only validated summary JSON under the ignored `test-resource/generated/evidence/` directory. Console output uses the same whitelist. Manually transfer only those fields needed by the committed RC evidence document; never transfer command output from other tools.

Path and credential overrides are environment-only so `pnpm` cannot echo them as command arguments: use `DEEPSEEK_KEY_FILE`, `ZHIPU_KEY_FILE`, `AZURE_SPEECH_KEY_FILE`, or `AZURE_SPEECH_WAV` when the ignored defaults are not suitable. Endpoint overrides likewise use `DEEPSEEK_BASE_URL` or `ZHIPU_BASE_URL` and still must pass the official-host URL policy.
