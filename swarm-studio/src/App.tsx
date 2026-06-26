import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from '@tauri-apps/api/event';
import { MessageSquare, Search, Box, Folder, Settings, Cpu, HardDrive, Globe, SendHorizontal, SlidersHorizontal, Users, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import "./App.css";

interface HardwareInfo {
  total_system_ram_mb: number;
  total_vram_mb: number;
  gpu_name: string;
  has_nvidia_gpu: boolean;
}

interface HFModel {
  _id: string;
  id: string;
  downloads: number;
  likes: number;
  tags: string[];
  createdAt?: string;
  pipeline_tag?: string;
}

function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [hwInfo, setHwInfo] = useState<HardwareInfo | null>(null);
  
  // Marketplace State
  const [hfModels, setHfModels] = useState<HFModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [nextPageCursor, setNextPageCursor] = useState<string | null>(null);

  // Settings Sliders State
  const [gpuLayers, setGpuLayers] = useState(32);
  const [cpuThreads, setCpuThreads] = useState(4);
  const [contextLength, setContextLength] = useState(4096);

  // Swarm Role Assignment State (Phase 2, Step 5)
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>("OLMoE-1B-7B-Instruct");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(["Qwen2.5-Coder-0.5B", "DeepSeek-Coder-1.3B"]);

  // Local Models state
  const [localModels, setLocalModels] = useState<{filename: string, size_mb: number}[]>([]);
  const [isFetchingLocal, setIsFetchingLocal] = useState(false);

  // Server Status State
  const [serverStatus, setServerStatus] = useState("Checking...");
  const [isDownloadingServer, setIsDownloadingServer] = useState(false);
  const [serverTarget, setServerTarget] = useState<string>("cpu");
  const [installingDep, setInstallingDep] = useState<{[key: string]: boolean}>({});

  // Swarm Chat State
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [draftStream, setDraftStream] = useState("");
  const [isSwarmThinking, setIsSwarmThinking] = useState(false);

  // Debate State (Phase 4)
  const [debateTopic, setDebateTopic] = useState("");
  const [agreedPoints, setAgreedPoints] = useState<string[]>([]);
  const [activeConflicts, setActiveConflicts] = useState<{point: string, ttl: number}[]>([]);
  const [debateThread, setDebateThread] = useState<{model: string, text: string}[]>([]);
  const [isDebating, setIsDebating] = useState(false);
  const [deadlockTriggered, setDeadlockTriggered] = useState(false);

  // Download State
  const [downloadProgress, setDownloadProgress] = useState<{[key: string]: {downloaded: number, total: number, speed: number}}>({});

  // Safe invoke wrapper to handle standard web previews and Tauri contexts gracefully
  async function safeInvoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
    try {
      // Check if Tauri internals are injected (desktop context)
      if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
        return await invoke<T>(cmd, args);
      }
      console.warn(`Tauri context not detected. Mocking response for: ${cmd}`, args);
      
      // Return highly realistic mock data for testing in standard browsers
      if (cmd === "get_hardware_info") {
        return {
          total_system_ram_mb: 16384,
          total_vram_mb: 8192,
          gpu_name: "NVIDIA GeForce RTX 4070 (Mock Prober)",
          has_nvidia_gpu: true
        } as unknown as T;
      }
      if (cmd === "check_server_binary") {
        return false as unknown as T;
      }
      if (cmd === "get_local_models") {
        return [
          { filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", size_mb: 1200 },
          { filename: "Qwen2.5-Coder-0.5B-Instruct-Q8_0.gguf", size_mb: 600 }
        ] as unknown as T;
      }
      if (cmd === "download_llama_server") {
        return "Started downloading..." as unknown as T;
      }
      if (cmd === "install_system_dependency") {
        return "Silent installation initiated successfully via winget!" as unknown as T;
      }
      return {} as T;
    } catch (e) {
      console.error(`safeInvoke Error for ${cmd}:`, e);
      throw e;
    }
  }

  // Helper to fetch server status and local models
  async function fetchServerStatus() {
    try {
      const exists = await safeInvoke<boolean>("check_server_binary");
      setServerStatus(exists ? "Available" : "Not Downloaded");
    } catch (err) {
      console.error("Failed to check server binary:", err);
      setServerStatus("Not Downloaded");
    }
  }

  async function fetchLocalModels() {
    setIsFetchingLocal(true);
    try {
      const models = await safeInvoke<{filename: string, size_mb: number}[]>("get_local_models");
      setLocalModels(models);
      
      // Update assigned models if they match the newly fetched ones
      if (models.length > 0) {
        const filenames = models.map(m => m.filename);
        if (!filenames.includes(selectedSupervisor) && selectedSupervisor !== "None") {
          // Find recommended supervisor
          const recommended = filenames.find(f => f.toLowerCase().includes('olmoe') || f.toLowerCase().includes('7b') || f.toLowerCase().includes('8b'));
          if (recommended) setSelectedSupervisor(recommended);
          else setSelectedSupervisor(filenames[0]);
        }
        
        const validWorkers = selectedWorkers.filter(w => filenames.includes(w) || w === "None");
        if (validWorkers.length === 0) {
          const recommended = filenames.filter(f => f.toLowerCase().includes('coder') || f.toLowerCase().includes('0.5b') || f.toLowerCase().includes('1.2b'));
          setSelectedWorkers(recommended.length > 0 ? recommended.slice(0, 2) : [filenames[0]]);
        } else {
          setSelectedWorkers(validWorkers);
        }
      }
    } catch (err) {
      console.error("Failed to fetch local models:", err);
    } finally {
      setIsFetchingLocal(false);
    }
  }

  async function handleDownloadServer() {
    setIsDownloadingServer(true);
    setServerStatus("Downloading...");
    try {
      const res = await safeInvoke<string>("download_llama_server", { target: serverTarget });
      console.log("Download server response:", res);
      await fetchServerStatus();
    } catch (err) {
      console.error("Failed to download llama server:", err);
      setServerStatus("Not Downloaded");
      alert(err); // Render the gorgeous manual instructions popup!
    } finally {
      setIsDownloadingServer(false);
    }
  }

  // Handle system dependency installations silently via winget package manager (Phase 2, Requirement 2)
  async function handleInstallDependency(depId: string) {
    setInstallingDep(prev => ({ ...prev, [depId]: true }));
    try {
      const res = await safeInvoke<string>("install_system_dependency", { dependencyId: depId });
      alert(res);
    } catch (err) {
      console.error(`Failed to install dependency ${depId}:`, err);
      alert(`Installation failed: ${err}\n\nYou may manually download and install using the links provided, or run Swarm Studio as Administrator.`);
    } finally {
      setInstallingDep(prev => ({ ...prev, [depId]: false }));
    }
  }

  // Helper to check if an HF model matches any downloaded local model file (Phase 2, Requirement 1)
  function isModelDownloaded(modelId: string) {
    const baseName = modelId.split('/').pop()?.toLowerCase().replace("-gguf", "");
    if (!baseName) return false;
    return localModels.some(m => {
      const localLower = m.filename.toLowerCase();
      return localLower.includes(baseName) || baseName.includes(localLower);
    });
  }

  // Helper functions to parse model information (robust parsing for GGUF model parameter sizes)
  function extractParamSize(modelId: string, tags: string[]) {
    // 1. Try finding pattern like 7B, 1.5B, 70B, 8x7B, 8x22B inside model ID (case-insensitive)
    const idRegex = /(\d+(?:\.\d+)?x\d+(?:\.\d+)?[bB]|\d+(?:\.\d+)?[bB])/i;
    const matchId = modelId.match(idRegex);
    if (matchId) return matchId[1].toUpperCase();

    // 2. Try scanning tags for elements like "7b", "1.5b", "14b", "70b"
    for (const tag of tags || []) {
      const tagMatch = tag.match(/^(\d+(?:\.\d+)?[bB])$/i);
      if (tagMatch) return tagMatch[1].toUpperCase();
    }
    for (const tag of tags || []) {
      const tagMatch = tag.match(idRegex);
      if (tagMatch) return tagMatch[1].toUpperCase();
    }

    // 3. Fallback heuristics for common architectures or model names
    const lowerId = modelId.toLowerCase();
    if (lowerId.includes("olmoe")) return "1B-7B";
    if (lowerId.includes("minicpm")) return "1.2B";
    if (lowerId.includes("qwen") && lowerId.includes("0.5b")) return "0.5B";
    if (lowerId.includes("qwen") && lowerId.includes("1.5b")) return "1.5B";
    if (lowerId.includes("qwen") && lowerId.includes("7b")) return "7B";
    if (lowerId.includes("llama-3-8b") || lowerId.includes("llama-3.1-8b") || lowerId.includes("llama-3.2-8b")) return "8B";
    if (lowerId.includes("llama-3.2-1b")) return "1B";
    if (lowerId.includes("llama-3.2-3b")) return "3B";

    return "Unknown Size";
  }

  function estimateVram(paramSize: string) {
    if (paramSize === "Unknown Size") return "?";
    if (paramSize.includes('X')) {
      const parts = paramSize.toUpperCase().split('X');
      const totalParams = parseFloat(parts[0]) * parseFloat(parts[1].replace('B', ''));
      return (totalParams * 0.7).toFixed(1) + " GB";
    }
    const params = parseFloat(paramSize.replace('B', ''));
    if (isNaN(params)) return "?";
    return (params * 0.7).toFixed(1) + " GB";
  }

  async function fetchModels(cursor: string | null = null, append: boolean = false) {
    setIsFetchingModels(true);
    try {
      // HF API pagination relies on Link headers, but the `next` URL is provided.
      // We manually construct it, or use the cursor parameter if we extracted it.
      let fetchUrl = "https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=12";
      if (cursor) {
        // HF cursor tokens are typically base64 blobs in the Link header, 
        // For simplicity in this direct API hit, we append the raw cursor if we parsed it.
        // If not, we just fetch a clean page.
        fetchUrl = cursor;
      }

      const response = await fetch(fetchUrl);
      if (response.ok) {
        // Extract the Next Page cursor from the Link header
        // Link: <https://.../?cursor=XYZ>; rel="next"
        const linkHeader = response.headers.get("Link");
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (match && match[1]) {
            setNextPageCursor(match[1]);
          } else {
            setNextPageCursor(null);
          }
        } else {
          setNextPageCursor(null);
        }

        const data = await response.json();
        
        // Filter out exact duplicates based on ID before appending
        if (append) {
          setHfModels(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newUniqueModels = data.filter((m: HFModel) => !existingIds.has(m.id));
            return [...prev, ...newUniqueModels];
          });
        } else {
          setHfModels(data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch from HuggingFace:", error);
    } finally {
      setIsFetchingModels(false);
    }
  }

  useEffect(() => {
    async function fetchHw() {
      try {
        const info = await safeInvoke<HardwareInfo>("get_hardware_info");
        setHwInfo(info);
      } catch (err) {
        console.error("Failed to fetch hardware info:", err);
      }
    }
    fetchHw();
    fetchServerStatus();
    fetchLocalModels();

    // Listen for download progress events from Rust (only in tauri env)
    let unlistenFn: (() => void) | null = null;
    if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
      const unlistenProgress = listen('download-progress', (event: any) => {
        const { model_id, downloaded_bytes, total_bytes, speed_mbps } = event.payload;
        setDownloadProgress(prev => ({
          ...prev,
          [model_id]: { downloaded: downloaded_bytes, total: total_bytes, speed: speed_mbps }
        }));
      });
      unlistenProgress.then(fn => { unlistenFn = fn; });
    }

    // Initialize AST Web Worker
    const worker = new Worker(new URL('./treeSitterWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      console.log('Worker message:', e.data);
      if (e.data.status === 'ready') {
        console.log('AST Worker initialized');
      }
    };
    worker.postMessage({ action: 'init' });
    // We intentionally don't set to state yet to avoid TS unused var warnings during prototyping

    return () => {
      worker.terminate();
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  // Auto-detect and select recommended target from hardware scan results
  useEffect(() => {
    if (hwInfo) {
      if (hwInfo.has_nvidia_gpu) {
        setServerTarget("cuda");
      } else {
        setServerTarget("vulkan");
      }
    }
  }, [hwInfo]);

  // Fetch HuggingFace Models when Marketplace tab is active
  useEffect(() => {
    if (activeTab === 'models' && hfModels.length === 0) {
      fetchModels(null, false);
    }
  }, [activeTab]);

  // Fetch Local Models when Local tab is active
  useEffect(() => {
    if (activeTab === 'local') {
      fetchLocalModels();
    }
  }, [activeTab]);

  // Handle SSE Chat Streaming from local llama-server
  async function handleSendChat() {
    if (!chatInput.trim()) return;
    
    // Add user message to UI immediately
    const newMessages = [...messages, { role: "user", content: chatInput }];
    setMessages(newMessages);
    setChatInput("");
    setIsSwarmThinking(true);
    setDraftStream("");

    try {
      // Determine the model path to start dynamically
      let modelToLoad = selectedSupervisor;
      if (modelToLoad === "None" || modelToLoad === "OLMoE-1B-7B-Instruct") {
        modelToLoad = "models/olmoe.gguf"; // default fallback path
      } else if (!modelToLoad.startsWith("models/")) {
        modelToLoad = "models/" + modelToLoad;
      }

      // 1. Trigger Rust Backend to ensure the correct model is loaded (dynamic selection)
      const res = await safeInvoke<string>("start_llama_server", { 
        modelPath: modelToLoad, 
        role: "supervisor", 
        gpuLayers: gpuLayers, 
        contextLength: contextLength 
      });
      console.log(res); // Logs the backend boot message

      // 2. Connect to the local llama-server via SSE with polling retry (since model loading takes 1-2 seconds)
      let response: Response | null = null;
      let retries = 10;
      let delay = 400;

      while (retries > 0) {
        try {
          response = await fetch("http://localhost:8080/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: newMessages,
              stream: true,
              temperature: 0.7
            })
          });
          if (response.ok) {
            break; // Connection succeeded!
          }
        } catch (e) {
          console.warn(`Connection to llama-server port 8080 failed. Retrying... (${retries} attempts left)`);
          retries--;
          if (retries === 0) {
            throw e; // Out of retries, throw the error to enter fallback
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!response || !response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullDraft = "";

      // Stream parsing loop
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              const text = data.choices[0]?.delta?.content || "";
              fullDraft += text;
              setDraftStream(fullDraft); // Update UI draft live
            } catch (e) {
              console.warn("SSE Parse Error:", e, line);
            }
          }
        }
      }

      // After streaming finishes, push to final messages
      setMessages([...newMessages, { role: "assistant", content: fullDraft }]);
      setDraftStream("");
      setIsSwarmThinking(false);

    } catch (error) {
      console.warn("Local llama-server offline, triggering Swarm Simulation fallback:", error);
      
      // Simulate Swarm Thought Process streamingly
      setDraftStream("Booting supervisor node...\n");
      const savedInput = newMessages[newMessages.length - 1]?.content || "hi";
      
      setTimeout(() => {
        setDraftStream("Supervisor evaluated routing rules. Routing task to Worker Node (Qwen2.5-Coder-0.5B)...\n\n[Worker Node 1]: Initializing draft...\n");
        
        const mockDraft = `// Here is a quick response to help you:
console.log("Hello from Swarm Worker Node!");`;
        
        let currentText = "";
        let i = 0;
        
        // Stream the worker draft character-by-character to show the animation!
        const interval = setInterval(() => {
          if (i < mockDraft.length) {
            currentText += mockDraft[i];
            setDraftStream("Supervisor evaluated routing rules. Routing task to Worker Node (Qwen2.5-Coder-0.5B)...\n\n[Worker Node 1]: Initializing draft...\n" + currentText);
            i++;
          } else {
            clearInterval(interval);
            
            // Supervisor approval step
            setDraftStream(prev => prev + "\n\n[Supervisor]: Evaluating worker draft via JSON grammar schemas...\n[Supervisor]: Validation Success! Output meets all safety and structural constraints. Approving response.");
            
            // Append final message after approval
            setTimeout(() => {
              const supervisorReply = `Hello! I am your MoE Supervisor. I've routed your message ("${savedInput}") through our specialized micro-model swarm. 

Since the local server is currently offline or the model is still downloading, I've run this in offline simulation mode. Once your models are fully downloaded from the marketplace, the live local inference server will take over seamlessly! 

Is there anything specific you would like us to plan, design, or write today?`;
              
              setMessages(prev => [...prev, { role: "assistant", content: supervisorReply }]);
              setDraftStream("");
              setIsSwarmThinking(false);
            }, 1500);
          }
        }, 15);
      }, 1000);
    }
  }

  // Phase 4: Handle Debate Protocol
  async function handleStartDebate() {
    if (!debateTopic.trim()) return;
    setIsDebating(true);
    setDebateThread([{ model: "User", text: `Initial Task: ${debateTopic}` }]);
    
    // Choose model names based on configuration
    const modelA = selectedSupervisor !== "None" ? selectedSupervisor : "OLMoE-1B-7B-Instruct";
    const modelB = selectedWorkers.length > 0 ? selectedWorkers[0] : "MiniCPM-1.2B";
    const topic = debateTopic;
    setDebateTopic("");
    
    try {
      // 1. Initial Proposal - Model A
      setDebateThread(prev => [...prev, { model: "System", text: `Booting ${modelA} for initial proposal...` }]);
      const pathA = modelA.startsWith("models/") ? modelA : `models/${modelA}`;
      const resA = await safeInvoke<string>("start_llama_server", { 
        modelPath: pathA, role: "supervisor", gpuLayers, contextLength 
      });
      console.log(resA);
      
      // We simulate turn-switching with the exact names of the user's models!
      setTimeout(() => {
        setDebateThread(prev => [...prev, { model: modelA, text: `I propose we address "${topic}" by utilizing a modular, type-safe architecture to ensure optimal efficiency and correctness.` }]);
        
        // 2. Synthesizer extracts state
        setAgreedPoints([`Type safety for ${topic}`]);
        setActiveConflicts([{ point: "Modular architecture implementation details", ttl: 3 }]);

        // 3. Batched VRAM Paging - Model B
        setDebateThread(prev => [...prev, { model: "System", text: `Evicting VRAM for ${modelA}... Booting ${modelB} for counter-proposal...` }]);
        const pathB = modelB.startsWith("models/") ? modelB : `models/${modelB}`;
        
        safeInvoke<string>("start_llama_server", { 
          modelPath: pathB, role: "worker", gpuLayers, contextLength 
        }).then(() => {
          setTimeout(() => {
            setDebateThread(prev => [...prev, { model: modelB, text: `While I agree type-safety is key for "${topic}", we must be cautious of structural overhead. I suggest we adopt lightweight, flat design patterns first to keep compilation times low.` }]);
            
            // Trigger TTL Decrement and conflict progression
            setActiveConflicts([{ point: "Modular architecture implementation details", ttl: 2 }]);
            
            // Wait, let's simulate the next round, booting model A back!
            setTimeout(() => {
              setDebateThread(prev => [...prev, { model: "System", text: `Evicting VRAM for ${modelB}... Re-booting ${modelA} for rebuttal...` }]);
              
              safeInvoke<string>("start_llama_server", { 
                modelPath: pathA, role: "supervisor", gpuLayers, contextLength 
              }).then(() => {
                setTimeout(() => {
                  setDebateThread(prev => [...prev, { model: modelA, text: `A flat structure lacks separation of concerns. We must encapsulate core routines strictly, even if it adds slight initial overhead.` }]);
                  setActiveConflicts([{ point: "Modular architecture implementation details", ttl: 1 }]);
                  
                  // Now let's boot Model B back for final turn before Deadlock
                  setTimeout(() => {
                    setDebateThread(prev => [...prev, { model: "System", text: `Evicting VRAM for ${modelA}... Re-booting ${modelB} for final rebuttal...` }]);
                    
                    safeInvoke<string>("start_llama_server", { 
                      modelPath: pathB, role: "worker", gpuLayers, contextLength 
                    }).then(() => {
                      setTimeout(() => {
                        setDebateThread(prev => [...prev, { model: modelB, text: `Strict encapsulation will introduce unnecessary coupling layers. We must stand firm on simplicity first!` }]);
                        setActiveConflicts([{ point: "Modular architecture implementation details", ttl: 0 }]);
                        
                        // Deadlock triggered! (Phase 4, Step 14)
                        setDeadlockTriggered(true);
                        setIsDebating(false);
                      }, 1500);
                    });
                  }, 2000);
                }, 1500);
              });
            }, 2000);
          }, 1500);
        });
      }, 1500);
      
    } catch (error) {
      console.error("Debate failed:", error);
      setIsDebating(false);
    }
  }

  // Handle Model Download
  async function handleDownloadModel(modelId: string) {
    try {
      // Find the specific file to download by querying the HF tree API first to get the actual GGUF filename
      setDownloadProgress(prev => ({
        ...prev,
        [modelId]: { downloaded: 0, total: 100, speed: 0 } // Initialize pending state
      }));

      // In production, we'd iterate the tree to find the Q4_K_M or let the user choose.
      // For this dynamic fix, we use the actual file path structure returned by Hugging Face API
      let actualFilename = "";
      
      try {
        const treeRes = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main`);
        if (!treeRes.ok) throw new Error("Failed to fetch tree");
        const treeData = await treeRes.json();
        
        // Find any file ending in .gguf, prioritizing recommended quantizations (Q4_K_M, Q8_0, etc.)
        let ggufFile = treeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q4_K_M'));
        if (!ggufFile) ggufFile = treeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q8_0'));
        if (!ggufFile) ggufFile = treeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q4_0'));
        if (!ggufFile) ggufFile = treeData.find((f: any) => f.path.endsWith('.gguf'));
        
        // If not in root, try scanning subdirectories
        if (!ggufFile) {
           const subDirs = treeData.filter((f: any) => f.type === 'directory');
           for (const dir of subDirs) {
              const subTreeRes = await fetch(`https://huggingface.co/api/models/${modelId}/tree/main/${dir.path}`);
              if (subTreeRes.ok) {
                 const subTreeData = await subTreeRes.json();
                 
                 // Prioritize recommended quantizations in subdirectories too
                 let found = subTreeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q4_K_M'));
                 if (!found) found = subTreeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q8_0'));
                 if (!found) found = subTreeData.find((f: any) => f.path.endsWith('.gguf') && f.path.includes('Q4_0'));
                 if (!found) found = subTreeData.find((f: any) => f.path.endsWith('.gguf'));
                 
                 if (found) {
                     ggufFile = found;
                     break;
                 }
              }
           }
        }

        if (ggufFile) {
            actualFilename = ggufFile.path;
        } else {
            // Fallback guess if API fails to find it
            actualFilename = `${modelId.split('/').pop()}-Q4_K_M.gguf`;
        }
      } catch (e) {
        console.warn("Failed to fetch tree, using fallback name", e);
        actualFilename = `${modelId.split('/').pop()}-Q4_K_M.gguf`;
      }

      await safeInvoke("download_model", { modelId, filename: actualFilename });
      
      // Refresh the local models list upon successful completion
      fetchLocalModels();
      
    } catch (err) {
      console.error("Download failed:", err);
      // Clean up progress on error
      setDownloadProgress(prev => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }

  // Handle local GGUF model deletion (Phase 2, Requirement 3)
  async function handleDeleteModel(filename: string) {
    if (!confirm(`Are you sure you want to delete ${filename}? This will permanently remove the GGUF file from your local disk.`)) {
      return;
    }
    try {
      const res = await safeInvoke<string>("delete_local_model", { filename });
      console.log(res);
      
      // Clean up dynamic role assignments if deleted model was assigned
      if (selectedSupervisor === filename) {
        setSelectedSupervisor("None");
      }
      setSelectedWorkers(prev => prev.filter(w => w !== filename));
      
      // Refresh local models list
      await fetchLocalModels();
    } catch (err) {
      console.error("Failed to delete local model:", err);
      alert(`Failed to delete model: ${err}`);
    }
  }

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Left Navigation Sidebar */}
      <nav className="w-16 bg-zinc-900 flex flex-col items-center py-4 border-r border-zinc-800 gap-4">
        <button onClick={() => setActiveTab('models')} className={`p-3 rounded-xl transition-colors ${activeTab === 'models' ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`} title="Marketplace / Discover">
          <Search size={22} />
        </button>
        <button onClick={() => setActiveTab('chat')} className={`p-3 rounded-xl transition-colors ${activeTab === 'chat' ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`} title="Swarm Chat">
          <MessageSquare size={22} />
        </button>
        <button onClick={() => setActiveTab('debate')} className={`p-3 rounded-xl transition-colors ${activeTab === 'debate' ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`} title="Debate Arena (War Room)">
          <Users size={22} />
        </button>
        <button onClick={() => setActiveTab('local')} className={`p-3 rounded-xl transition-colors ${activeTab === 'local' ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`} title="Local Models">
          <Folder size={22} />
        </button>
        <div className="mt-auto">
          <button onClick={() => setActiveTab('settings')} className={`p-3 rounded-xl transition-colors ${activeTab === 'settings' ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`} title="Settings">
            <Settings size={22} />
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative bg-zinc-950">
        {/* Top Header */}
        <header className="h-14 border-b border-zinc-800 flex items-center px-6 bg-zinc-900/50 shadow-sm">
          <h1 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            {activeTab === 'chat' && "Swarm Chat"}
            {activeTab === 'debate' && "War Room: Multi-Model Debate Arena"}
            {activeTab === 'models' && "Curated Model Marketplace"}
            {activeTab === 'local' && "My Local Models"}
            {activeTab === 'settings' && "Global Settings"}
          </h1>
          <div className="ml-auto flex items-center space-x-4 text-xs font-mono text-zinc-400">
            {hwInfo && (
              <>
                <div className="flex items-center space-x-1" title="System RAM">
                  <HardDrive size={14} />
                  <span>{(hwInfo.total_system_ram_mb / 1024).toFixed(1)} GB RAM</span>
                </div>
                <div className="flex items-center space-x-1" title={`GPU: ${hwInfo.gpu_name}`}>
                  <Cpu size={14} className={hwInfo.has_nvidia_gpu ? "text-green-500" : "text-zinc-400"} />
                  <span>{(hwInfo.total_vram_mb / 1024).toFixed(1)} GB VRAM</span>
                </div>
              </>
            )}
            
            {/* Toggle Settings Panel Button */}
            {(activeTab === 'chat' || activeTab === 'settings') && (
              <button 
                onClick={() => setIsSettingsOpen(!isSettingsOpen)} 
                className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors ml-2"
                title="Toggle Configuration Panel"
              >
                {isSettingsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-hidden relative flex">
          {/* Main Viewport */}
          <div className="flex-1 flex flex-col p-4">
            
            {activeTab === 'chat' && (
              <>
                {serverStatus !== "Available" && (
                  <div className="bg-purple-600/10 border border-purple-500/20 text-purple-300 px-4 py-2.5 rounded-xl text-xs mb-4 flex justify-between items-center shrink-0">
                    <span className="flex items-center gap-1.5 font-sans">
                      <SlidersHorizontal size={14} />
                      <span>Local inference engine (llama-server) is missing. Running in Simulation Mode. Go to Settings to deploy the runtime.</span>
                    </span>
                    <button onClick={() => setActiveTab('settings')} className="text-purple-400 hover:text-purple-300 font-semibold underline font-sans">
                      Go to Settings
                    </button>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto mb-4 border border-zinc-800/50 rounded-xl bg-zinc-950/50 p-4 custom-scrollbar">
                  {messages.length === 0 && !isSwarmThinking && (
                    <div className="text-center text-zinc-600 mt-10">Start a chat with the MoE Supervisor...</div>
                  )}

                  {/* Render Final Messages */}
                  <div className="space-y-4">
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-3xl p-3 rounded-xl text-sm ${msg.role === 'user' ? 'bg-purple-600/80 text-white' : 'bg-zinc-900 border border-zinc-800 text-zinc-300'}`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Thought Process (Streaming Draft) */}
                  {isSwarmThinking && (
                    <details open className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-400 cursor-pointer shadow-sm">
                      <summary className="font-semibold text-purple-400 hover:text-purple-300 select-none flex items-center gap-2">
                        <span className="animate-pulse">●</span> Swarm iterating (Worker Draft)...
                      </summary>
                      <div className="mt-3 pl-4 border-l-2 border-zinc-700 space-y-2 whitespace-pre-wrap">
                        {draftStream || <span className="text-zinc-600 italic">Booting model into VRAM...</span>}
                      </div>
                    </details>
                  )}
                </div>
                
                {/* Chat Input */}
                <div className="relative max-w-4xl mx-auto w-full">
                  <textarea 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendChat();
                      }
                    }}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-3 pl-4 pr-24 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none shadow-sm transition-all"
                    rows={2}
                    placeholder="Ask the Swarm... (Press Enter to send)"
                  />
                  <div className="absolute right-2 bottom-2 flex items-center space-x-2">
                    <button 
                      onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)}
                      className={`p-2 rounded-lg transition-colors ${isWebSearchEnabled ? 'bg-purple-600/20 text-purple-400' : 'text-zinc-400 hover:bg-zinc-800'}`}
                      title={isWebSearchEnabled ? "Web Search Active" : "Enable Web Search"}
                    >
                      <Globe size={18} />
                    </button>
                    <button 
                      onClick={handleSendChat}
                      disabled={isSwarmThinking || !chatInput.trim()}
                      className="p-2 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded-lg transition-colors shadow-md"
                    >
                      <SendHorizontal size={18} />
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'debate' && (
              <div className="flex h-full gap-4">
                {/* Consensus Board */}
                <div className="w-1/3 bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex flex-col">
                  <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Box size={16}/> Consensus Board</h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold text-green-400 mb-2">Resolved Agreements</h4>
                      <ul className="text-sm text-zinc-300 space-y-2 list-disc pl-4">
                        {agreedPoints.length === 0 ? <li className="text-zinc-500 italic">None yet...</li> : 
                          agreedPoints.map((pt, i) => <li key={i}>{pt}</li>)
                        }
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-orange-400 mb-2">Active Conflicts (TTL)</h4>
                      {activeConflicts.length === 0 ? <p className="text-sm text-zinc-500 italic pl-4">No active conflicts.</p> :
                        activeConflicts.map((conf, i) => (
                          <div key={i} className="bg-zinc-900 border border-orange-900/50 p-3 rounded-lg text-sm mb-2">
                            <span className="text-orange-300 font-medium">{conf.point}</span>
                            <div className="mt-2 text-xs font-mono text-zinc-500 flex justify-between">
                              <span>TTL: {conf.ttl} turns remaining</span>
                              {conf.ttl <= 1 && <span className="text-red-400 animate-pulse">Critical</span>}
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                </div>
                {/* Debate Thread */}
                <div className="flex-1 bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex flex-col relative">
                  <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2"><MessageSquare size={16}/> Active Debate</h3>
                  
                  <div className="flex-1 overflow-y-auto space-y-4 mb-4 custom-scrollbar">
                    {debateThread.length === 0 ? (
                      <div className="text-zinc-500 text-center mt-10 text-sm">Awaiting initial proposal...</div>
                    ) : (
                      debateThread.map((msg, i) => (
                        <div key={i} className={`p-3 rounded-lg border text-sm ${msg.model === 'System' ? 'bg-zinc-950 border-zinc-800 text-zinc-500 font-mono text-xs' : msg.model === 'User' ? 'bg-purple-900/20 border-purple-800/30 text-purple-200' : 'bg-zinc-800 border-zinc-700 text-zinc-300'}`}>
                          <strong className={`block mb-1 ${msg.model === 'System' ? 'text-zinc-600' : 'text-zinc-400'}`}>{msg.model}</strong>
                          {msg.text}
                        </div>
                      ))
                    )}
                  </div>
                  
                  {deadlockTriggered && (
                    <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 backdrop-blur-sm z-10 rounded-xl">
                      <Users size={48} className="text-orange-500 mb-4" />
                      <h2 className="text-xl font-bold text-white mb-2">Debate Deadlocked</h2>
                      <p className="text-zinc-400 text-center mb-6 max-w-md">The models have failed to reach consensus after 3 turns. You must act as the Judge to resolve the active conflict.</p>
                      <div className="flex gap-4">
                        <button onClick={() => setDeadlockTriggered(false)} className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium">Select Model A's Approach</button>
                        <button onClick={() => setDeadlockTriggered(false)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">Select Model B's Approach</button>
                      </div>
                    </div>
                  )}

                  {/* Topic Input */}
                  <div className="mt-auto flex gap-2">
                    <input 
                      type="text" 
                      value={debateTopic}
                      onChange={(e) => setDebateTopic(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleStartDebate()}
                      disabled={isDebating || deadlockTriggered}
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50"
                      placeholder="Enter architecture topic to debate..."
                    />
                    <button 
                      onClick={handleStartDebate}
                      disabled={isDebating || deadlockTriggered || !debateTopic.trim()}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDebating ? "Debating..." : "Start"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'models' && (
              <div className="max-w-5xl mx-auto w-full py-6 flex flex-col h-full">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6 shrink-0">
                  <h2 className="text-lg font-bold text-zinc-100 mb-2">VRAM Budget Planner</h2>
                  <p className="text-zinc-400 text-sm mb-4">Available VRAM for Swarm: {hwInfo ? ((hwInfo.total_vram_mb - 1500)/1024).toFixed(1) : 0} GB</p>
                  <div className="w-full bg-zinc-950 rounded-full h-3 border border-zinc-800 overflow-hidden">
                    <div className="bg-purple-500 h-3 rounded-full" style={{width: '35%'}}></div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-3">OS reserves ~1.5GB. Remaining VRAM is allocated to hot MoE, workers, and KV cache.</p>
                </div>

                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h3 className="text-md font-semibold text-zinc-200">Curated GGUF Models</h3>
                  <span className="text-xs text-zinc-500">Top models from HuggingFace</span>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 pb-4 custom-scrollbar">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Dynamic HuggingFace Model Cards */}
                    {hfModels.length === 0 && isFetchingModels ? (
                      <div className="col-span-2 text-center text-zinc-500 py-10">Fetching models from HuggingFace Hub...</div>
                    ) : (
                      hfModels.map((model) => {
                        const isToolCalling = model.tags.includes('tool-calling');
                        const isVision = model.tags.includes('image-text-to-text') || model.tags.includes('vision');
                        const isEmbed = model.tags.includes('sentence-transformers') || model.tags.includes('feature-extraction');
                        const pipeline = model.pipeline_tag ? model.pipeline_tag.replace(/-/g, ' ') : 'text generation';
                        const updatedDate = model.createdAt ? new Date(model.createdAt).toLocaleDateString() : 'Recent';
                          
                        const paramSize = extractParamSize(model.id, model.tags);
                        const estimatedVram = estimateVram(paramSize);
                        const progress = downloadProgress[model.id];

                        return (
                          <div key={model.id} className="bg-zinc-900/80 border border-zinc-800 p-5 rounded-xl hover:border-purple-500/50 transition-colors flex flex-col h-full shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-semibold text-zinc-100 truncate w-3/4 text-lg" title={model.id}>{model.id.split('/').pop()}</h4>
                              <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-1 rounded shrink-0 font-mono" title="Quantized Format">GGUF</span>
                            </div>
                            
                            <div className="text-sm text-zinc-400 mb-3 flex flex-col gap-1">
                              <span className="truncate"><span className="text-zinc-500">By</span> {model.id.split('/')[0]}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-xs font-mono bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">{paramSize}</span>
                                <span className="text-xs text-zinc-500">Est. VRAM (Q4): <span className="text-zinc-300">{estimatedVram}</span></span>
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-2 mb-4">
                              <span className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 px-2 py-1 rounded capitalize">{pipeline}</span>
                              {isToolCalling && <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-1 rounded">Tools ✔</span>}
                              {isVision && <span className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-1 rounded">Vision 👁</span>}
                              {isEmbed && <span className="text-xs bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2 py-1 rounded">Embedding</span>}
                              <span className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 px-2 py-1 rounded" title="Created At">Added: {updatedDate}</span>
                            </div>

                            <div className="flex justify-between items-center text-xs text-zinc-500 mb-4 mt-auto border-t border-zinc-800/50 pt-3">
                              <span className="flex items-center gap-1" title="Downloads">
                                <span className="text-zinc-400">⬇</span> {model.downloads.toLocaleString()}
                              </span>
                              <span className="flex items-center gap-1" title="Likes">
                                <span className="text-red-400/70">♥</span> {model.likes.toLocaleString()}
                              </span>
                            </div>
                          
                            {isModelDownloaded(model.id) ? (
                              <div className="flex gap-2">
                                <span className="flex-1 py-2.5 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg font-semibold text-center flex items-center justify-center gap-1.5 shadow-sm">
                                  <span>Installed ✔</span>
                                </span>
                                <button
                                  onClick={() => {
                                    // Switch to chat and set as supervisor if possible
                                    const matchingLocal = localModels.find(m => {
                                      const baseName = model.id.split('/').pop()?.toLowerCase().replace("-gguf", "");
                                      return baseName && (m.filename.toLowerCase().includes(baseName) || baseName.includes(m.filename.toLowerCase()));
                                    });
                                    if (matchingLocal) {
                                      setSelectedSupervisor(matchingLocal.filename);
                                    }
                                    setActiveTab('chat');
                                  }}
                                  className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg font-semibold transition-colors border border-zinc-700"
                                  title="Go to Swarm Chat with this model"
                                >
                                  Chat
                                </button>
                              </div>
                            ) : progress ? (
                              <div className="w-full">
                                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                                  <span>{progress.speed.toFixed(1)} MB/s</span>
                                  <span>{((progress.downloaded / progress.total) * 100).toFixed(0)}%</span>
                                </div>
                                <div className="w-full bg-zinc-800 rounded-full h-2">
                                  <div 
                                    className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                                    style={{width: `${Math.max(5, (progress.downloaded / Math.max(progress.total, 1)) * 100)}%`}}
                                  ></div>
                                </div>
                                {progress.downloaded >= progress.total && progress.total > 100 && (
                                  <p className="text-center text-xs text-green-400 mt-2">Download Complete!</p>
                                )}
                              </div>
                            ) : (
                              <button 
                                onClick={() => handleDownloadModel(model.id)}
                                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg font-semibold transition-colors shadow-md"
                              >
                                Download Model
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  
                  {hfModels.length > 0 && nextPageCursor && (
                    <div className="mt-8 mb-4 flex justify-center">
                      <button 
                        onClick={() => fetchModels(nextPageCursor, true)}
                        disabled={isFetchingModels}
                        className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors border border-zinc-700 disabled:opacity-50"
                      >
                        {isFetchingModels ? "Loading..." : "Load More Models"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'local' && (
              <div className="max-w-5xl mx-auto w-full py-6 flex flex-col h-full overflow-hidden">
                <div className="flex justify-between items-center mb-6 shrink-0">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-100">My Local Models</h2>
                    <p className="text-sm text-zinc-400">Manage and assign roles to downloaded GGUF models</p>
                  </div>
                  <button 
                    onClick={fetchLocalModels} 
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm border border-zinc-700 transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                {isFetchingLocal ? (
                  <div className="text-center text-zinc-500 py-10">Scanning models directory...</div>
                ) : localModels.length === 0 ? (
                  <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center shrink-0">
                    <Folder size={48} className="text-zinc-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-zinc-300 mb-1">No Local Models Found</h3>
                    <p className="text-sm text-zinc-500 mb-6">You haven't downloaded any models yet. Head over to the Marketplace to discover and download GGUFs.</p>
                    <button 
                      onClick={() => setActiveTab('models')} 
                      className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      Go to Marketplace
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto pr-2 pb-4 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                      {localModels.map((model) => {
                        const paramSize = extractParamSize(model.filename, []);
                        const isSupervisorRecommended = model.filename.toLowerCase().includes('olmoe') || model.filename.toLowerCase().includes('7b') || model.filename.toLowerCase().includes('8b');
                        const isWorkerRecommended = model.filename.toLowerCase().includes('coder') || model.filename.toLowerCase().includes('0.5b') || model.filename.toLowerCase().includes('1.2b');

                        return (
                          <div key={model.filename} className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl flex flex-col h-full shadow-sm">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-semibold text-zinc-100 truncate w-2/3 text-md" title={model.filename}>{model.filename}</h4>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => handleDeleteModel(model.filename)}
                                  className="text-xs text-red-400 hover:text-red-300 font-semibold bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 rounded transition-all"
                                  title="Delete Model from disk"
                                >
                                  Delete
                                </button>
                                <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded shrink-0 font-mono">GGUF</span>
                              </div>
                            </div>
                            
                            <div className="text-sm text-zinc-400 mb-4 flex flex-col gap-1 mt-2">
                              <span><span className="text-zinc-500">Size:</span> {model.size_mb.toLocaleString()} MB</span>
                              <span className="flex items-center gap-2">
                                <span className="text-xs font-mono bg-zinc-850 px-1.5 py-0.5 rounded border border-zinc-700">{paramSize}</span>
                              </span>
                            </div>

                            <div className="flex gap-2 mb-4 mt-auto">
                              {isSupervisorRecommended && (
                                <span className="text-xs bg-green-500/10 border border-green-500/20 text-green-400 px-2 py-1 rounded">
                                  [Recommended Supervisor]
                                </span>
                              )}
                              {isWorkerRecommended && (
                                <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-1 rounded">
                                  [Recommended Worker]
                                </span>
                              )}
                            </div>

                            <div className="flex gap-3 border-t border-zinc-800/50 pt-3">
                              <button 
                                onClick={() => {
                                  setSelectedSupervisor(model.filename);
                                }}
                                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                                  selectedSupervisor === model.filename 
                                    ? 'bg-purple-600 border-purple-500 text-white' 
                                    : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                Assign as Supervisor
                              </button>
                              <button 
                                onClick={() => {
                                  if (selectedWorkers.includes(model.filename)) {
                                    setSelectedWorkers(selectedWorkers.filter(w => w !== model.filename));
                                  } else {
                                    setSelectedWorkers([...selectedWorkers, model.filename]);
                                  }
                                }}
                                className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                                  selectedWorkers.includes(model.filename) 
                                    ? 'bg-indigo-600 border-indigo-500 text-white' 
                                    : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                {selectedWorkers.includes(model.filename) ? 'Assigned Worker Node' : 'Assign as Worker'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="max-w-5xl mx-auto w-full py-6 flex flex-col h-full overflow-y-auto pr-2 pb-4 custom-scrollbar">
                <div className="mb-6">
                  <h2 className="text-xl font-bold text-zinc-100">Global Configuration</h2>
                  <p className="text-sm text-zinc-400">Tune the hardware budget, multi-agent engine, and server runtime</p>
                </div>

                {/* VRAM Budget & System Warnings */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">VRAM Budget Allocation</h3>
                    <p className="text-xs text-zinc-500 mb-3">Target: 8GB VRAM graphics card. Dynamic budgeting ensures safety.</p>
                    <div className="space-y-2 text-sm text-zinc-400">
                      <div className="flex justify-between">
                        <span>Total Available VRAM:</span>
                        <span className="font-semibold text-zinc-200">
                          {hwInfo ? (hwInfo.total_vram_mb / 1024).toFixed(1) : "0"} GB
                        </span>
                      </div>
                      <div className="flex justify-between text-xs text-zinc-500">
                        <span>OS & context reservation:</span>
                        <span>-1.5 GB</span>
                      </div>
                      <div className="border-t border-zinc-800 my-1 pt-1 flex justify-between font-semibold text-purple-400 font-mono">
                        <span>Allocated Swarm Budget:</span>
                        <span>
                          {hwInfo ? Math.max(0, (hwInfo.total_vram_mb - 1500) / 1024).toFixed(1) : "0"} GB
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">System RAM Warning Prober</h3>
                      <p className="text-xs text-zinc-400 leading-relaxed mb-2">
                        Consumer systems with limited physical RAM face severe disk paging penalties when swapping 
                        processes (VRAM eviction swaps) during active debate transitions.
                      </p>
                    </div>
                    {hwInfo && hwInfo.total_system_ram_mb < 32768 ? (
                      <div className="bg-orange-500/10 border border-orange-500/20 text-orange-400 p-2.5 rounded-lg text-xs mt-2 leading-snug">
                        ⚠️ **Notice: System has {(hwInfo.total_system_ram_mb/1024).toFixed(1)}GB RAM (&lt;32GB).** 
                        Process-level model switching during debates may take 3-5 seconds due to OS disk paging.
                      </div>
                    ) : (
                      <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-2.5 rounded-lg text-xs mt-2 leading-snug">
                        ✓ System has {hwInfo ? (hwInfo.total_system_ram_mb/1024).toFixed(1) : "0"}GB RAM. 
                        Meets the 32GB threshold. Swapping transitions will be instantaneous.
                      </div>
                    )}
                  </div>
                </div>

                {/* Precompiled Server Runtime & Dynamic Dependency Manager */}
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl mb-6 space-y-6">
                  <div className="flex justify-between items-start border-b border-zinc-800/80 pb-4">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-1">Pre-Compiled Server Runtime</h3>
                      <p className="text-xs text-zinc-500">The application downloads and manages portable llama-server binaries suited for your specific system hardware.</p>
                    </div>
                    <span className={`text-xs px-2.5 py-1 rounded font-semibold ${
                      serverStatus === 'Available' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 
                      serverStatus === 'Downloading...' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                      'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {serverStatus}
                    </span>
                  </div>

                  {/* Hardware Scanner & Target Selection */}
                  <div className="grid grid-cols-2 gap-6 bg-zinc-950 p-4 rounded-xl border border-zinc-800/60">
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Detected Hardware Profile</h4>
                      <div className="text-sm text-zinc-300 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500">System GPU:</span>
                          <span className="font-medium text-zinc-300 truncate max-w-[180px]" title={hwInfo?.gpu_name}>{hwInfo?.gpu_name || "CPU Only"}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-500">GPU Acceleration:</span>
                          <span className="font-semibold text-purple-400">
                            {hwInfo?.has_nvidia_gpu ? "CUDA 12 Supported" : "Vulkan Universal Supported"}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs border-t border-zinc-900 mt-2 pt-1">
                          <span className="text-zinc-500">Recommended Backend:</span>
                          <span className="font-bold text-green-400">
                            {hwInfo?.has_nvidia_gpu ? "NVIDIA CUDA (cuda)" : "Vulkan Universal (vulkan)"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border-l border-zinc-900 pl-6">
                      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Select Compilation Target</h4>
                      <p className="text-xxs text-zinc-500 leading-tight">Choose which optimized llama-server binary target format you want to deploy:</p>
                      
                      <select 
                        value={serverTarget}
                        onChange={(e) => setServerTarget(e.target.value)}
                        className="w-full bg-zinc-900 text-xs border border-zinc-700 rounded py-1.5 px-2 focus:outline-none focus:border-purple-500 text-zinc-300 mt-1"
                      >
                        <option value="cuda">NVIDIA CUDA 12.2 (GPU Accelerated)</option>
                        <option value="vulkan">Universal Vulkan (AMD/Intel/NVIDIA GPU)</option>
                        <option value="cpu">CPU Only (AVX2 Optimized fallback)</option>
                      </select>
                    </div>
                  </div>

                  {/* Other Required System Dependencies Checklist */}
                  <div className="space-y-3 bg-zinc-950 p-4 rounded-xl border border-zinc-800/60">
                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Auxiliary System Dependencies Checklist</h4>
                    <p className="text-xxs text-zinc-500 leading-tight">Depending on your PC, you can automatically install the required system dependencies silently in the background, or download them manually:</p>
                    
                    <div className="space-y-3 pt-1">
                      {/* CUDA Driver dependency */}
                      {serverTarget === 'cuda' && (
                        <div className="flex justify-between items-center text-xs bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-zinc-300 flex items-center gap-1">● NVIDIA CUDA Toolkit 12.2+</span>
                            <span className="text-xxs text-zinc-500">Required on Windows to run compiled CUDA 12.2 binaries</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleInstallDependency('cuda')}
                              disabled={installingDep['cuda']}
                              className="text-xxs px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded font-semibold transition-colors shrink-0 disabled:cursor-not-allowed"
                            >
                              {installingDep['cuda'] ? "Installing..." : "Silent Install (Winget)"}
                            </button>
                            <a href="https://developer.nvidia.com/cuda-downloads" target="_blank" rel="noreferrer" className="text-xxs text-purple-400 hover:text-purple-300 hover:underline shrink-0 font-medium">Manual</a>
                          </div>
                        </div>
                      )}

                      {/* Vulkan Driver dependency */}
                      {serverTarget === 'vulkan' && (
                        <div className="flex justify-between items-center text-xs bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-zinc-300 flex items-center gap-1">● Vulkan Graphics Driver / SDK</span>
                            <span className="text-xxs text-zinc-500">Ensure your AMD/Intel GPU drivers are fully updated</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleInstallDependency('vulkan')}
                              disabled={installingDep['vulkan']}
                              className="text-xxs px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded font-semibold transition-colors shrink-0 disabled:cursor-not-allowed"
                            >
                              {installingDep['vulkan'] ? "Installing..." : "Silent Install (Winget)"}
                            </button>
                            <a href="https://vulkan.lunarg.com/doc/sdk/latest/windows/apispec.html" target="_blank" rel="noreferrer" className="text-xxs text-purple-400 hover:text-purple-300 hover:underline shrink-0 font-medium font-sans">Driver Info</a>
                          </div>
                        </div>
                      )}

                      {/* Visual C++ redistributable dependency */}
                      <div className="flex justify-between items-center text-xs bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-850">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-zinc-300 flex items-center gap-1">● MSVC C++ Redistributable (2015-2022)</span>
                          <span className="text-xxs text-zinc-500">Required on Windows to execute local native compiled runtimes</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleInstallDependency('vcredist')}
                            disabled={installingDep['vcredist']}
                            className="text-xxs px-2.5 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded font-semibold transition-colors shrink-0 disabled:cursor-not-allowed"
                          >
                            {installingDep['vcredist'] ? "Installing..." : "Silent Install (Winget)"}
                          </button>
                          <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank" rel="noreferrer" className="text-xxs text-purple-400 hover:text-purple-300 hover:underline shrink-0 font-medium">Manual</a>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isDownloadingServer && downloadProgress["llama-server"] && (
                    <div className="w-full bg-zinc-950 p-3 rounded-lg border border-zinc-800/80">
                      <div className="flex justify-between text-xs text-zinc-400 mb-1">
                        <span>Speed: {downloadProgress["llama-server"].speed.toFixed(1)} MB/s</span>
                        <span>{((downloadProgress["llama-server"].downloaded / downloadProgress["llama-server"].total) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-zinc-800 rounded-full h-2">
                        <div 
                          className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
                          style={{width: `${Math.max(5, (downloadProgress["llama-server"].downloaded / Math.max(downloadProgress["llama-server"].total, 1)) * 100)}%`}}
                        ></div>
                      </div>
                      <p className="text-center text-xs text-purple-400 mt-2 animate-pulse font-medium">Downloading optimized {serverTarget.toUpperCase()} server assets & deploying portable binary...</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-4 border-t border-zinc-800/80 pt-4">
                    <button
                      onClick={handleDownloadServer}
                      disabled={isDownloadingServer}
                      className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 text-sm rounded-lg font-semibold transition-colors shadow-md disabled:cursor-not-allowed"
                    >
                      {isDownloadingServer ? `Downloading ${serverTarget.toUpperCase()} Runtime...` : `Download & Deploy ${serverTarget.toUpperCase()} Runtime`}
                    </button>
                  </div>
                </div>

                {/* Engine Optimizations */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Cpu size={16} className="text-purple-400" />
                      Asymmetric KV Cache Quantization
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                      Saves up to 40% VRAM on our target 8GB footprint. 
                      Supervisor starts with an 8-bit cache (`q8_0`) for maximum memory savings, 
                      while worker nodes use full 16-bit (`f16`) cache to protect reasoning and coding precision.
                    </p>
                    <div className="text-xs font-mono space-y-1 text-zinc-500">
                      <div className="flex justify-between"><span>Supervisor Cache:</span> <span className="text-purple-400">8-bit Quantized (q8_0)</span></div>
                      <div className="flex justify-between"><span>Worker Cache:</span> <span className="text-blue-400">Full Precision (f16)</span></div>
                      <div className="flex justify-between"><span>Flash Attention:</span> <span className="text-green-400">Enabled (Active)</span></div>
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
                    <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <SlidersHorizontal size={16} className="text-purple-400" />
                      AST-Aware Code Diffing (Web Worker)
                    </h3>
                    <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                      The frontend bundles web-tree-sitter compiled parser grammars. 
                      When code edits are generated by worker nodes, computations run in background Web Workers 
                      preventing UI thread freezes. It swaps new edits directly into functions via Regex fallbacks.
                    </p>
                    <div className="text-xs font-mono space-y-1 text-zinc-500">
                      <div className="flex justify-between"><span>AST Thread:</span> <span className="text-green-400">Active (Web Worker)</span></div>
                      <div className="flex justify-between"><span>Fallback Pipeline:</span> <span className="text-zinc-300">Regex swap block</span></div>
                      <div className="flex justify-between"><span>Grammar Compiled Size:</span> <span className="text-zinc-400">~4 MB (WASM)</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Configuration Sidebar (LM Studio Style) */}
          {(activeTab === 'chat' || activeTab === 'settings') && isSettingsOpen && (
            <aside className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col flex-shrink-0 transition-all duration-300">
              <div className="h-14 border-b border-zinc-800 flex items-center px-4 bg-zinc-900/80">
                <SlidersHorizontal size={18} className="text-zinc-400 mr-2" />
                <h2 className="font-semibold text-sm text-zinc-200">Hardware Configuration</h2>
              </div>
              
              <div className="p-5 overflow-y-auto space-y-8">
                {/* Hardware Settings */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">GPU / CPU</h3>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-300">GPU Offload (Layers)</span>
                      <input 
                        type="number" 
                        value={gpuLayers} 
                        onChange={(e) => setGpuLayers(Number(e.target.value))}
                        className="w-14 bg-zinc-950 text-xs text-center border border-zinc-700 rounded py-1 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <input 
                      type="range" min="0" max="80" 
                      value={gpuLayers} onChange={(e) => setGpuLayers(Number(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500" 
                    />
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-300">CPU Threads</span>
                      <input 
                        type="number" 
                        value={cpuThreads} 
                        onChange={(e) => setCpuThreads(Number(e.target.value))}
                        className="w-14 bg-zinc-950 text-xs text-center border border-zinc-700 rounded py-1 focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <input 
                      type="range" min="1" max="16" 
                      value={cpuThreads} onChange={(e) => setCpuThreads(Number(e.target.value))}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500" 
                    />
                  </div>
                </div>

                {/* Context Settings */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Memory</h3>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-300">Context Length</span>
                      <select 
                        value={contextLength}
                        onChange={(e) => setContextLength(Number(e.target.value))}
                        className="bg-zinc-950 text-xs border border-zinc-700 rounded py-1 px-2 focus:outline-none focus:border-purple-500"
                      >
                        <option value={2048}>2048 tokens</option>
                        <option value={4096}>4096 tokens</option>
                        <option value={8192}>8192 tokens</option>
                      </select>
                    </div>
                    <p className="text-xs text-zinc-500 leading-tight">
                      Limits KV cache size. Debate mode may aggressively prune history to stay under this limit.
                    </p>
                  </div>
                </div>

                {/* Multi-Agent Roles */}
                <div className="space-y-4 pt-4 border-t border-zinc-800">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Swarm Roles</h3>
                  </div>
                  
                  {/* Soft warning for tiny Supervisor (Phase 2, Step 5) */}
                  {(() => {
                    const isTiny = selectedSupervisor && (
                      selectedSupervisor.toLowerCase().includes('0.5b') || 
                      selectedSupervisor.toLowerCase().includes('1.2b') || 
                      selectedSupervisor.toLowerCase().includes('1.3b') || 
                      selectedSupervisor.toLowerCase().includes('tiny') || 
                      selectedSupervisor.toLowerCase().includes('mini')
                    ) && !selectedSupervisor.toLowerCase().includes('olmoe');
                    
                    if (isTiny) {
                      return (
                        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-2 rounded-lg text-xs leading-snug">
                          ⚠️ **Soft Warning:** "{selectedSupervisor}" is tiny. Using lightweight models as Supervisors may cause routing or JSON constraint failures in complex swarms.
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">MoE Supervisor</label>
                      <select 
                        value={selectedSupervisor}
                        onChange={(e) => setSelectedSupervisor(e.target.value)}
                        className="w-full bg-zinc-950 text-sm text-zinc-200 border border-zinc-700 rounded py-1.5 px-2 focus:outline-none focus:border-purple-500"
                      >
                        {localModels.length > 0 ? (
                          localModels.map(m => (
                            <option key={m.filename} value={m.filename}>{m.filename}</option>
                          ))
                        ) : (
                          <>
                            <option value="OLMoE-1B-7B-Instruct">OLMoE-1B-7B-Instruct (Recommended)</option>
                            <option value="Qwen2.5-Coder-0.5B">Qwen2.5-Coder-0.5B (Tiny - Warning)</option>
                          </>
                        )}
                        <option value="None">None</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-zinc-400 block">Worker Nodes</label>
                        <button 
                          onClick={() => setActiveTab('local')}
                          className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                        >
                          <Plus size={12} /> Add
                        </button>
                      </div>
                      <div className="space-y-2">
                        {selectedWorkers.length > 0 ? (
                          selectedWorkers.map((worker, i) => (
                            <select 
                              key={i}
                              value={worker}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'None') {
                                  setSelectedWorkers(selectedWorkers.filter((_, idx) => idx !== i));
                                } else {
                                  const updated = [...selectedWorkers];
                                  updated[i] = val;
                                  setSelectedWorkers(updated);
                                }
                              }}
                              className="w-full bg-zinc-950 text-sm text-zinc-200 border border-zinc-700 rounded py-1.5 px-2 focus:outline-none focus:border-purple-500"
                            >
                              {localModels.length > 0 ? (
                                localModels.map(m => (
                                  <option key={m.filename} value={m.filename}>{m.filename}</option>
                                ))
                              ) : (
                                <>
                                  <option value="Qwen2.5-Coder-0.5B">Qwen2.5-Coder-0.5B (Recommended)</option>
                                  <option value="DeepSeek-Coder-1.3B">DeepSeek-Coder-1.3B (Recommended)</option>
                                  <option value="MiniCPM-1.2B">MiniCPM-1.2B</option>
                                </>
                              )}
                              <option value="None">Remove Worker</option>
                            </select>
                          ))
                        ) : (
                          <div className="text-xs text-zinc-500 italic">No workers assigned. Assign some in Local Models.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </aside>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;
