# Known Limitations for 0.1.0-rc.1

- Supported platform: Apple Silicon, macOS 15 or later.
- Distribution: internal `.app`, ad-hoc signed, not notarized. Developer ID signing, notarization, DMG packaging, and automatic updates are deferred.
- Intel macOS and non-macOS builds are not release targets.
- The bundled third-party notice covers direct runtime dependencies. A complete transitive license inventory and license-text bundle is required before any external distribution.
- Waveform visualization is deferred. Playback uses native audio controls and word timestamps.
- DeepSeek, Azure Speech, and Zhipu require credentials supplied by the user and explicit acceptance of cloud data disclosure version 1.
- Generated WAV storage is limited to 2 GiB. The app never silently removes history-owned media; capacity is released by deleting individual history records.
- Legacy media records without `audioPath` remain readable as reports but cannot replay audio.
