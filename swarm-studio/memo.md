# Swarm Studio - Developer Memo

## Current State (Post-Stability & Feature Integration)
The project is a local offline multi-agent AI desktop app with a verified, clean Git baseline and enhanced stability.

- **Tech Stack:** Tauri 2.0, Rust, React 19, TypeScript, TailwindCSS v4.
- **Git:** Root-level repository initialized and pushed to `shyyamsh/SwarmStudio`.
- **Backend Stability:**
  - **Inference Engine:** Stabilized with **AVX2 (CPU)** and **CUDA (GPU)** build support. Corrected `--flash-attn on` syntax.
  - **Process Management:** Implemented hard process termination for the inference server to immediately free VRAM and System RAM.
  - **Web Search:** Unicode-safe scraper (`search.py`) with UTF-8 enforcement for Windows compatibility.
- **Frontend Features:**
  - **Model Compatibility Engine:** Real-time filtering of marketplace models based on architecture (Gemma 4 blacklist) and hardware limits (VRAM/RAM heuristics).
  - **Internet Context Injection:** Automatic search result integration into LLM prompts with a visual "Web Context" box in the chat feed.
  - **Halt Mechanism:** Emergency "Stop" button to kill long-running inference tasks immediately.
  - **Hardware Monitoring:** Proactive header displaying active CPU and GPU (RTX 4060) status with real-time VRAM tracking.

## Hand-off Instructions for Next Agent
1. Read /memories/repo/plan.md and /memories/repo/architecture_decisions.md for the full architectural blueprint.
2. **Current Goal:** Begin **Phase 3: Multi-Agent Engine** (web-tree-sitter integration).
3. **Immediate Tasks:**
   - Implement the `tree-sitter` Web Worker logic to handle AST parsing for code diffing.
   - Refine the MoE Supervisor's routing prompt to handle multiple worker models.
   - Test the "Deadlock Termination" logic in the Debate Arena.
