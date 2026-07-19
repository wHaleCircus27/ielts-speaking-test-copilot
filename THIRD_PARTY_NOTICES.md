# Third-Party Notices

IELTS Speaking Test Copilot includes open-source software. The following direct runtime dependencies are material to the distributed application; their transitive dependencies remain governed by the license metadata and license files distributed in their source packages.

## Web Runtime

| Component | Version | License |
| --- | --- | --- |
| `@tauri-apps/api` | 2.11.0 | Apache-2.0 OR MIT |
| `lucide-react` | 1.16.0 | ISC |
| `microsoft-cognitiveservices-speech-sdk` | 1.50.0 | MIT |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |

## Native Runtime

The native bundle directly uses Tauri, reqwest, rfd, rusqlite, serde, serde_json, sha2, quick-xml, security-framework, thiserror, url, and uuid. These crates declare MIT, Apache-2.0, or dual MIT/Apache-2.0 licensing in their package metadata.

The complete resolved dependency versions are fixed by `pnpm-lock.yaml` and `src-tauri/Cargo.lock`. Source, license texts, and upstream attribution remain available from each package's registry entry and source distribution.

This notice does not replace or modify any third-party license.
