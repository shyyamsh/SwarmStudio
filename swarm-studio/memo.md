# Swarm Studio - Developer Memo

## Current State (Post-Stability & Git Sync)
The project is a local offline multi-agent AI desktop app with a verified, clean Git baseline.

- **Tech Stack:** Tauri 2.0, Rust, React 19, TypeScript, TailwindCSS v4.
- **Git:** Root-level repository initialized and pushed to `shyyamsh/SwarmStudio`. Massive model files and build artifacts are ignored.
- **Backend Stability:**
  - **Extraction Engine:** Switched to native `tar` extraction for Windows 10/11, resolving PowerShell file locks.
  - **Download Engine:** Implemented HTTP Range support for **resumable model downloads**. Added 3-attempt retries for server binaries.
  - **Permissions:** Admin privileges are now requested only for **release builds**, ensuring a smooth, non-elevated development cycle.
- **Hardware & Dependencies:**
  - Smart detection for `vcredist`, `CUDA`, and `Vulkan` libraries before attempting installation.
  - Automatic runtime target selection based on GPU probing (RTX 4060 detected).
- **UI:** Verified stable build. Syntax errors (JSX/Braces) from previous automated refactors have been resolved and the file tail cleaned of metadata.

## Hand-off Instructions for Next Agent
1. Read /memories/repo/plan.md and /memories/repo/architecture_decisions.md for the full architectural blueprint.
2. **Frontend Restoration:** `src/App.tsx` has been restored to a functional state. Note that the "Simulation Mode" fallback was removed to favor real server connectivity.
3. **Onboarding Integration:** The next step is to safely re-integrate the `performReadinessCheck` and Onboarding UI without breaking the JSX structure. Use small, atomic edits.
4. **Immediate Tasks:**
   - Verify the `llama-server.exe` extraction path logic in `lib.rs` (absolute vs relative).
   - Re-enable the hardware scan results in the Top Header for real-time monitoring.
   - Begin **Phase 3: Multi-Agent Engine** (web-tree-sitter integration).
