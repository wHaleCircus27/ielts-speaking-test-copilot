# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

**Frontend:**
- `pnpm dev` — Vite dev server on port 1420
- `pnpm build` — TypeScript check + Vite production build
- `pnpm typecheck` — TypeScript type checking only
- `pnpm test` — Run Vitest tests
- `pnpm tauri dev` — Launch full Tauri desktop app in dev mode

**Rust backend:**
- `cd src-tauri && cargo build` — Build Rust backend
- `cd src-tauri && cargo test -- --test-threads=1` — Run Rust tests (must be sequential)

**Utilities:**
- `pnpm azure:speech-preflight` — Verify Azure Speech SDK setup
- `pnpm mvp4:verify` — MVP 4 readiness check

## Architecture

Tauri 2 desktop app: React frontend communicates with a Rust backend via Tauri IPC commands.

**Frontend** (React 18 + TypeScript + Vite + Tailwind CSS):
- `src/features/` — Feature modules (settings, grading, media, speech, corpus)
- `src/lib/` — API wrappers and utilities that invoke Tauri commands
- `src/components/` — Shared UI components

**Backend** (`src-tauri/src/`):
- `grading.rs` — DeepSeek API integration for text evaluation
- `media.rs` — FFmpeg transcoding (WAV 16kHz 16-bit mono PCM)
- `speech.rs` — Azure Speech Services pronunciation assessment
- `corpus.rs` — SQLite + Zhipu embeddings for teacher RAG

**Data flow:** Frontend → Tauri invoke → Rust command → external service → structured result back to frontend.

## External Services

- **DeepSeek** — Text grading (models: v4-flash, v4-pro, chat, reasoner)
- **Azure Speech Services** — Pronunciation assessment in continuous mode; backend signs short-lived tokens
- **Zhipu** — embedding-3 model for corpus RAG
- **FFmpeg** — Media transcoding sidecar (lookup: env var → sidecar → system → afconvert fallback)

## Key Conventions

- UI language is Chinese (Simplified); English only for technical labels and API model names
- API keys are never in frontend source — Rust backend handles all external calls
- Test media files go in `test-resource/` (gitignored)
- Frontend state uses React hooks + localStorage (no Redux/Zustand)
- Errors use a structured `AppError` type (code, message, optional detail) serialized as JSON from Rust
- Three theme variants: `theme-claude`, `theme-animal`, `theme-glass` (configured in Tailwind)

## Testing

- Frontend: Vitest with jsdom environment and Testing Library
- Rust: sequential test execution required (`--test-threads=1`)
- Test setup: `src/test/setup.ts`
