## Plan: Local Offline Multi-Agent AI (LM-Studio Clone with 8GB VRAM Target)

**Overview**
A lightweight, fully offline, multi-agent AI desktop application modeled after LM Studio. Designed to run on consumer hardware (8GB VRAM limit), the application features automated hardware detection, dynamic dependency downloading, and an advanced orchestration architecture. A resident MoE (Mixture of Experts) supervisor model evaluates and routes tasks to multiple highly-specialized, user-selected micro-models (0.5B-1.5B parameters).

**Architecture & App Structure**

```text
/src
  /ui-frontend        # Tauri (React/TypeScript) - Low memory footprint UI
  /core-backend       # Native Rust backend (Hardware scanner & process manager)
  /agents             # Python/Rust logic mapping routing & evaluation loops
  /bin                # Downloaded portable `llama.cpp` binaries (CUDA/Vulkan)
  /models             # Downloaded .gguf files
```

**Steps**

**Phase 1: Application Shell, UI, & Hardware Prober (Tauri + Rust)**

1. Initialize a Tauri project (Rust + React) to keep the desktop app memory footprint <50MB and bypass Python's heavy distribution overhead.
2. Implement a background Rust hardware prober (`nvml-wrapper` for NVIDIA, `sysinfo` for others) to scan total System RAM and GPU VRAM.
3. Build the UI featuring: Chat interface, "Swarm Visualizer" (showing agent state), and a **Hardware-Aware Model Marketplace**.

**Phase 2: Dynamic Setup & User Selection**
4. Create the setup logic: Based on the hardware scan, the app calculates a "VRAM Budget" (e.g., Total VRAM minus 1.5GB for OS/Context).
5. **Model Information & Marketplace:** The UI dynamically fetches model metadata directly from the HuggingFace API, ensuring even the latest models are listed with capabilities, parameters, and descriptions, mimicking LM Studio.
6. **Flexible Limits & RAM Offloading:** The UI suggests model combinations that fit the VRAM budget. However, if a user selects models that exceed the GPU limit, the UI will *not* prevent it. Instead, it displays a warning: *"This combination exceeds your hardware capability and may slow down or freeze the system. Proceed?"* If confirmed, the engine will strictly use `llama.cpp`'s layer offloading to push the excess layers into System RAM. It will *not* shrink the context window to save space.
7. The Rust backend automatically downloads portable, pre-compiled engine binaries (`llama.cpp` CUDA/Vulkan) and the user-selected `.gguf` model files. *This avoids OS-level driver installations entirely.*

**Phase 3: Advanced Multi-Agent Engine (MoE Supervisor & Evaluator Loop)**
8. Set up the inference engine via the downloaded binaries utilizing **Asymmetric Tiering**.
9. **Implement the Supervisor:** Use `OLMoE-1B-7B-Instruct` (Apache 2.0). It requires ~4GB VRAM at 4-bit, acts as a highly intelligent MoE supervisor, and leaves ~2.5GB for workers and context.
10. **Implement the Worker Swarm:** Load the user's selected micro-workers (e.g., `Qwen2.5-Coder-0.5B`, `MiniCPM-1.2B`) into the remaining VRAM via memory-mapping (`mmap`).
11. **Implement the Actor-Critic Orchestration Loop with User Steering:**
    - Supervisor routes task to Worker.
    - Worker generates output in real-time, which is streamed to the UI's "Swarm Visualizer" so the user can watch the progress.
    - *User Steering Interrupt:* The user chats exclusively with the Supervisor, but if they see a worker going in the wrong direction in the visualizer, they can interrupt and tell the Supervisor to course-correct that specific model.
    - Supervisor evaluates the worker's final output using constrained JSON grammar.
    - If Approved: Final output sent to UI chat.
    - If Rejected: Supervisor passes critique back to Worker for a retry.

**Verification**

1. Test app on an NVIDIA machine to ensure the Rust prober correctly calculates VRAM and suggests a valid model bundle.
2. Monitor VRAM via the app's internal dashboard to ensure peak usage (MoE Supervisor + Workers + KV Cache) stays strictly under 7.5GB.
3. Force a failing worker prompt to validate the Supervisor's "Actor-Critic" loop successfully rejects, critiques, and prompts the worker to correct itself before returning the final response.

**Decisions**

- **Hardware/Backend Strategy:** Confirmed Rust (Tauri native) as the definitive best option. It is infinitely more reliable for hardware probing and memory management than packaged Python executables.
- **User Choice:** Hardcoded model lists are removed in favor of a dynamic "VRAM Budget" marketplace where users select their own swarm members.
- **Supervisor Intelligence:** Upgraded from a standard dense model to `OLMoE-1B-7B`. As an MoE, it offers 7B-level intelligence for routing and critiquing, but only activates 1B parameters during generation, making it incredibly fast.
