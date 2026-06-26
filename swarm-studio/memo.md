# Swarm Studio - Developer Memo

## Current State (As of Phase 2 Completion)
The project is a local offline multi-agent AI desktop app (LM Studio clone) with an 8GB VRAM target.
- **Tech Stack:** Tauri, Rust, React, TypeScript, TailwindCSS v4.
- **UI:** 3-pane War Room, Collapsible settings, Hardware sliders, VRAM budget calculator.
- **Backend:** Rust native prober (sysinfo, 
vml-wrapper) working and passing data to the frontend.
- **Marketplace:** Dynamically fetches GGUF models from Hugging Face API, parses parameter size, estimates VRAM usage, supports pagination.
- **Downloads:** Rust command download_llama_server scaffolded via eqwest.

## Hand-off Instructions for Next Agent
1. Read /memories/session/plan.md and /memories/repo/architecture_decisions.md for the full architectural blueprint.
2. We are currently starting **Phase 3: Multi-Agent Engine & Memory Management**.
3. **Immediate Tasks:**
   - Integrate web-tree-sitter (WASM) in the React frontend via Web Workers for AST-aware diffing without blocking the UI.
   - Implement Rust backend process orchestration (std::process::Command) to launch the downloaded llama-server.exe with --cache-type q8_0 (Supervisor) or 16 (Worker) and manage process termination (SIGTERM).
   - Set up Server-Sent Events (SSE) in React to capture the streamed output from llama-server and render it in the Thought Process <details> block.
