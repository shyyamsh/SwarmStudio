## Plan: Local Offline Multi-Agent AI (LM-Studio Clone with 8GB VRAM Target)

**Overview**
A lightweight, fully offline, multi-agent AI desktop application modeled after LM Studio. Designed to run on consumer hardware (8GB VRAM limit), the application features automated hardware detection, dynamic dependency downloading, and an advanced orchestration architecture. A resident MoE (Mixture of Experts) supervisor model evaluates and routes tasks to multiple highly-specialized micro-models (0.5B-1.5B parameters). Additionally, it features a Multi-Model Debate Arena where massive MoE models can architecturally debate user prompts in a controlled "War Room" UI, using strict Process-Level VRAM Eviction and TTL-based Deadlock Resolution to respect hardware constraints.

**Architecture & App Structure**
```text
/src
  /ui-frontend        # Tauri (React/TypeScript) - Low memory footprint UI
  /core-backend       # Native Rust backend (Hardware scanner & `llama-server` manager)
  /agents             # Python/Rust logic mapping routing, evaluation, and context limits
  /bin                # Downloaded portable `llama-server` binaries (CUDA/Vulkan)
  /models             # Downloaded .gguf files
```

**Steps**

**Phase 1: Application Shell, UI, & Hardware Prober (Tauri + Rust)**
1. Initialize a Tauri project (Rust + React) to keep the desktop app memory footprint <50MB.
2. Implement a background Rust hardware prober (`nvml-wrapper` for NVIDIA, `sysinfo` for others) to scan System RAM and GPU VRAM.
3. Build the UI featuring: Chat interface, "Swarm Thought Process" visualizer (collapsible dropdown), and a **Curated Model Marketplace**.

**Phase 2: Dynamic Setup & Safe Model Hub**
4. **Hardware Budgeting:** App calculates a "VRAM Budget" (Total VRAM minus 1.5GB for OS/Context).
5. **Guided Flexibility & Role Assignment:** The UI fetches metadata from HuggingFace (`tags: ["gguf"]`). Users can download any model and freely assign who acts as Supervisor and Worker. To prevent broken swarms, the UI tags models as `[Recommended Supervisor]` and `[Recommended Worker]`. If a user assigns a tiny model as Supervisor, a soft warning is displayed.
6. **Pre-Flight Metadata Validation:** Before launching, Rust reads the GGUF header via the `gguf` crate. If the embedded `tokenizer.chat_template` is missing or malformed, it injects a safe fallback (`--chat-template chatml`) via startup flags to prevent runtime crashes.
7. **Pre-Compiled Server:** The Rust backend downloads the portable **`llama-server`** binary.

**Phase 3: Multi-Agent Engine & Memory Management**
8. **Asymmetric KV Cache Quantization:** Launch the Supervisor instance with an 8-bit KV Cache (`--cache-type q8_0`) to save massive VRAM, but launch the Worker instance with `f16` KV Cache to protect the fragile reasoning of micro-models. Both utilize Flash Attention.
9. **AST-Aware Code Diffing (WASM & Web Workers):** 
    - The Tauri frontend bundles lightweight WASM-compiled `tree-sitter` grammars (~4MB total).
    - To prevent UI thread freezing during large AST computations, the frontend offloads `tree-sitter` execution to dedicated **Web Workers**.
    - Supervisor instructs the Worker to rewrite specific *named functions*. The Web Worker parses the AST and swaps the newly generated function into the source state.
10. **The Thought-Process UX Loop:** 
    - Worker generates output; streamed to the UI inside a collapsed `<details>` block labeled *"Worker iterating..."*.
    - Supervisor evaluates the Draft via strict JSON grammar constraints.
    - *If Rejected:* Critique is appended to the hidden Thought Process, and the Worker loops.
    - *If Approved:* The final validated output is beautifully rendered in the main UI chat.
    - *User Steering:* Users can open the details block and interrupt the loop to steer the models manually.

**Phase 4: Multi-Model Debate Arena (Architecture Design)**
11. **Debate UI (War Room):** A 3-pane workspace. Left: "Consensus Board" (Agreements & Conflicts with TTL). Center: Debate Thread (auto-summarized to bullet points, expandable to raw text to prevent overwhelm). Right: User Judge controls.
12. **Process-Level VRAM Eviction (NVML Polling):** Dynamic layer shifting leaks CUDA memory. Rust executes *Hard Process Orchestration* by killing Model A's process and booting Model B. 
    - **VRAM Race Condition Fix:** Rust implements a tight `nvml` polling loop, ensuring Model A's VRAM is completely released by the NVIDIA driver *before* booting Model B.
    - **System RAM Warning:** If the host has <32GB Total System RAM, surface a tooltip warning that turn-switching may take 3-5 seconds due to OS disk paging.
13. **Dynamic Consensus & State Machine:** 
    - **Initial Proposal:** Selected models submit their proposed plans.
    - **The Zero-Shot Synthesizer:** Rust sends a stateless, Temp 0, JSON-constrained API call to the *currently loaded* MoE model to summarize the turn. It extracts `Resolved_Agreements` and `Active_Conflicts`.
    - **Pruning Heuristic:** To prevent Synthesizer context bloat, Rust limits `Resolved_Agreements` to a strict token count (e.g., top 5 most recent).
    - **Context Truncation:** The prompt is rebuilt using *only* the pruned Synthesizer output.
14. **Deadlock Termination (TTL & User Judge):** Conflicts use a hard TTL (Time-To-Live). If a conflict persists in the JSON state for 3 consecutive turns, it hits Deadlock. The system suspends, and the User Judge pane activates, forcing the user to manually resolve the deadlock before proceeding.

**Verification**
1. Ensure the HF fetch logic strictly filters out incompatible architectures and correctly assigns ChatML/Jinja templates to downloaded GGUFs.
2. Monitor `llama-server` via local HTTP to ensure Flash Attention and KV Cache caps are actively keeping VRAM under 7.5GB during an active Actor-Critic loop.
3. Verify that a 3-iteration rejection loop does not trigger an OOM crash, confirming the Context Truncation logic is working.
4. **Debate VRAM Eviction:** Monitor `nvidia-smi` during Debate transitions to ensure Model A's VRAM drops completely before Model B allocates, verifying Process-Level Orchestration.