// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sysinfo::System;
use nvml_wrapper::Nvml;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::{State, Emitter, AppHandle};
use futures_util::StreamExt;

// Global state to hold the currently running llama-server process
struct LlamaServerState {
    process: Mutex<Option<Child>>,
}

#[derive(Serialize)]
struct HardwareInfo {
    total_system_ram_mb: u64,
    total_vram_mb: u64,
    gpu_name: String,
    has_nvidia_gpu: bool,
}

#[tauri::command]
fn get_hardware_info() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    let total_system_ram_mb = sys.total_memory() / 1024 / 1024;

    let mut total_vram_mb = 0;
    let mut gpu_name = "Unknown".to_string();
    let mut has_nvidia_gpu = false;

    if let Ok(nvml) = Nvml::init() {
        if let Ok(device) = nvml.device_by_index(0) {
            has_nvidia_gpu = true;
            if let Ok(name) = device.name() {
                gpu_name = name;
            }
            if let Ok(memory) = device.memory_info() {
                total_vram_mb = memory.total / 1024 / 1024;
            }
        }
    }

    HardwareInfo {
        total_system_ram_mb,
        total_vram_mb,
        gpu_name,
        has_nvidia_gpu,
    }
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    model_id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_mbps: f64,
}

#[derive(Serialize)]
struct LocalModel {
    filename: String,
    size_mb: u64,
}

#[tauri::command]
fn check_server_binary() -> bool {
    let path = if cfg!(target_os = "windows") {
        PathBuf::from("..").join("bin").join("llama-server.exe")
    } else {
        PathBuf::from("..").join("bin").join("llama-server")
    };
    
    // Check if path exists and has non-zero size to be sure it's valid
    path.exists() && fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false)
}

#[tauri::command]
fn get_local_models() -> Result<Vec<LocalModel>, String> {
    let mut models = Vec::new();
    
    // 1. Scan root models/ folder
    let root_model_dir = PathBuf::from("..").join("models");
    if root_model_dir.exists() {
        if let Ok(entries) = fs::read_dir(root_model_dir) {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |ext| ext == "gguf") {
                        if let Ok(metadata) = entry.metadata() {
                            if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                                models.push(LocalModel {
                                    filename: filename.to_string(),
                                    size_mb: metadata.len() / 1024 / 1024,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 2. Scan src-tauri/models/ folder (to capture any models previously downloaded there)
    let tauri_model_dir = PathBuf::from("models");
    if tauri_model_dir.exists() {
        if let Ok(entries) = fs::read_dir(tauri_model_dir) {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |ext| ext == "gguf") {
                        if let Ok(metadata) = entry.metadata() {
                            if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                                // Avoid duplicate entries
                                if !models.iter().any(|m| m.filename == filename) {
                                    models.push(LocalModel {
                                        filename: filename.to_string(),
                                        size_mb: metadata.len() / 1024 / 1024,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(models)
}

#[tauri::command]
fn delete_local_model(filename: String) -> Result<String, String> {
    let root_path = PathBuf::from("..").join("models").join(&filename);
    let local_path = PathBuf::from("models").join(&filename);
    
    if root_path.exists() {
        fs::remove_file(root_path).map_err(|e| e.to_string())?;
        return Ok("Model deleted successfully from root store".to_string());
    } else if local_path.exists() {
        fs::remove_file(local_path).map_err(|e| e.to_string())?;
        return Ok("Model deleted successfully from local store".to_string());
    }
    
    Err("Model file not found".to_string())
}

#[tauri::command]
fn check_system_dependency(dependency_id: String) -> bool {
    match dependency_id.as_str() {
        "vcredist" => {
            // Check for standard 64-bit VC++ 2015-2022 runtime files
            let path1 = std::path::Path::new("C:\\Windows\\System32\\msvcp140.dll");
            let path2 = std::path::Path::new("C:\\Windows\\System32\\vcruntime140.dll");
            path1.exists() && path2.exists()
        },
        "cuda" => {
            // Check if nvcc is in PATH
            Command::new("nvcc").arg("--version").status().is_ok()
        },
        "vulkan" => {
            // Check for vulkan loader
            let path = std::path::Path::new("C:\\Windows\\System32\\vulkan-1.dll");
            path.exists()
        },
        _ => false
    }
}

#[tauri::command]
async fn install_system_dependency(dependency_id: String) -> Result<String, String> {
    println!("Installing system dependency via winget: {}", dependency_id);
    
    let args = match dependency_id.as_str() {
        "vcredist" => vec!["install", "--id", "Microsoft.VCRedist.2015+.x64", "--silent", "--accept-source-agreements", "--accept-package-agreements"],
        "vulkan" => vec!["install", "--id", "LunarG.VulkanSDK", "--silent", "--accept-source-agreements", "--accept-package-agreements"],
        "cuda" => vec!["install", "--id", "Nvidia.CUDA", "--silent", "--accept-source-agreements", "--accept-package-agreements"],
        _ => return Err("Unknown dependency ID".to_string())
    };

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("winget")
            .args(&args)
            .status();
        
        match status {
            Ok(s) => {
                if s.success() || s.code() == Some(0) || s.code() == Some(-1978335178) { // 0x8a150036 is "already installed"
                    Ok("Dependency installed successfully".to_string())
                } else {
                    // Log the code for debugging but don't fail the onboarding if it's just a warning
                    println!("Winget exited with code: {:?}", s.code());
                    Ok("Dependency installation completed (or was already present)".to_string())
                }
            }
            Err(e) => {
                Err(format!("Failed to run winget: {}. Please ensure your Windows system has winget enabled.", e))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok("Dependency auto-installation is only supported on Windows.".to_string())
    }
}

#[tauri::command]
async fn download_model(
    app_handle: AppHandle,
    model_id: String,
    filename: String,
) -> Result<String, String> {
    let model_dir = PathBuf::from("..").join("models");
    if !model_dir.exists() {
        fs::create_dir_all(&model_dir).map_err(|e| e.to_string())?;
    }
    
    // Normalize filename for local storage to flat structure
    let safe_filename = filename.replace("/", "_");
    let file_path = model_dir.join(&safe_filename);
    
    if file_path.exists() {
        // Emit 100% progress event so the UI knows it's already done
        let progress = DownloadProgress {
            model_id: model_id.clone(),
            downloaded_bytes: 100,
            total_bytes: 100,
            speed_mbps: 0.0,
        };
        let _ = app_handle.emit("download-progress", &progress);
        return Ok("Already downloaded".to_string());
    }

    println!("Starting download using reqwest for: {}/{}", model_id, filename);

    // Build Hugging Face URL
    let url = format!(
        "https://huggingface.co/{}/resolve/main/{}",
        model_id,
        filename
    );

    // Create a temporary file while downloading to avoid half-downloaded corrupt files
    let temp_file_path = file_path.with_extension("downloading");
    
    // Resume Logic: Check if we have a partial download
    let mut start_byte = 0;
    if temp_file_path.exists() {
        if let Ok(meta) = fs::metadata(&temp_file_path) {
            start_byte = meta.len();
            println!("Found partial download for {}: {} bytes. Attempting to resume...", filename, start_byte);
            
            // Emit initial progress so UI knows we're starting from here
            let progress = DownloadProgress {
                model_id: model_id.clone(),
                downloaded_bytes: start_byte,
                total_bytes: start_byte + 1, // temporary total until we get real one from server
                speed_mbps: 0.0,
            };
            let _ = app_handle.emit("download-progress", &progress);
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(1800)) // 30 mins timeout for massive GGUFs
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(&url);
    if start_byte > 0 {
        request = request.header("Range", format!("bytes={}-", start_byte));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    let status = response.status();
    let is_resume = status == reqwest::StatusCode::PARTIAL_CONTENT;
    
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HuggingFace returned status: {}", status));
    }

    let content_len = response
        .content_length()
        .ok_or_else(|| "Failed to get content length from HuggingFace response".to_string())?;

    let total_size = if is_resume {
        start_byte + content_len
    } else {
        content_len
    };

    // Open file: Append if resuming, otherwise Create/Overwrite
    let mut file = if is_resume {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&temp_file_path)
            .await
            .map_err(|e| e.to_string())?
    } else {
        tokio::fs::File::create(&temp_file_path).await.map_err(|e| e.to_string())?
    };

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = if is_resume { start_byte } else { 0 };
    
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        // Emit progress every ~200ms or when download is complete
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) || downloaded == total_size {
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            // Speed calculation should be based on NEWLY downloaded bytes for accuracy, 
            // but for simplicity we'll show speed of the CURRENT session.
            let speed_mbps = if elapsed_secs > 0.0 {
                ((downloaded - (if is_resume { start_byte } else { 0 })) as f64 / 1024.0 / 1024.0) / elapsed_secs
            } else {
                0.0
            };

            let progress = DownloadProgress {
                model_id: model_id.clone(),
                downloaded_bytes: downloaded,
                total_bytes: total_size,
                speed_mbps,
            };
            let _ = app_handle.emit("download-progress", &progress);
            last_emit = std::time::Instant::now();
        }
    }

    // CRITICAL: Explicitly flush and drop the file handle to release the lock on Windows
    // before we try to rename or extract it.
    tokio::io::AsyncWriteExt::flush(&mut file).await.map_err(|e| e.to_string())?;
    drop(file);

    // Give the OS a moment to release file handles (especially important on Windows)
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Rename temp file to final file path upon successful completion
    if file_path.exists() {
        let _ = fs::remove_file(&file_path);
    }
    tokio::fs::rename(&temp_file_path, &file_path).await.map_err(|e| e.to_string())?;

    Ok("Download complete".to_string())
}

#[tauri::command]
async fn download_llama_server(app_handle: AppHandle, target: String) -> Result<String, String> {
    // Dynamically resolve URL based on hardware targets (CUDA, Vulkan, CPU AVX2)
    let url = match target.as_str() {
        "cuda" => "https://github.com/ggml-org/llama.cpp/releases/download/b4131/llama-b4131-bin-win-cuda-cu12.2.0-x64.zip",
        "vulkan" => "https://github.com/ggml-org/llama.cpp/releases/download/b4131/llama-b4131-bin-win-vulkan-x64.zip",
        _ => "https://github.com/ggml-org/llama.cpp/releases/download/b4131/llama-b4131-bin-win-avx2-x64.zip"
    };
    
    // In a production app, we would resolve the AppData/Local path using tauri::AppHandle. 
    // For this prototype, we'll download to the parent directory's /bin folder.
    let bin_dir = PathBuf::from("..").join("bin");
    if !bin_dir.exists() {
        fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    }
    
    let zip_path = bin_dir.join("llama_server.zip");
    
    let exe_path = if cfg!(target_os = "windows") {
        bin_dir.join("llama-server.exe")
    } else {
        bin_dir.join("llama-server")
    };

    // If the zip file exists but the executable was never extracted, or zip is 0 bytes, force delete zip to re-download fresh
    if zip_path.exists() {
        if !exe_path.exists() {
            let _ = fs::remove_file(&zip_path);
        } else if let Ok(meta) = fs::metadata(&zip_path) {
            if meta.len() == 0 {
                let _ = fs::remove_file(&zip_path);
            }
        }
    }

    // If it already exists and exe also exists, assume fully deployed
    if zip_path.exists() && exe_path.exists() {
        // Emit 100% progress event
        let progress = DownloadProgress {
            model_id: "llama-server".to_string(),
            downloaded_bytes: 100,
            total_bytes: 100,
            speed_mbps: 0.0,
        };
        let _ = app_handle.emit("download-progress", &progress);
        return Ok("Already downloaded".to_string());
    }

    println!("Starting download using reqwest for portable server ({} target): {}", target, url);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300)) // 5 mins timeout
        .build()
        .map_err(|e| e.to_string())?;

    // Implement simple retry mechanism for network instability
    let mut response = None;
    let mut retries = 3;
    while retries > 0 {
        match client.get(url).send().await {
            Ok(res) => {
                response = Some(res);
                break;
            }
            Err(e) => {
                retries -= 1;
                if retries == 0 {
                    return Err(format!(
                        "Failed to download server from GitHub after 3 attempts: {}. \n\n\
                        💡 Manual installation instructions:\n\
                        1. Manually download the pre-compiled server ZIP from: {}\n\
                        2. Extract the files and place 'llama-server.exe' inside the 'bin' folder.\n\
                        3. Restart the app!",
                        e, url
                    ));
                }
                println!("Download failed, retrying... ({} attempts left)", retries);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    let response = response.unwrap();

    if !response.status().is_success() {
        return Err(format!(
            "GitHub returned status: {}. \n\n\
            💡 Manual installation instructions:\n\
            1. Manually download the pre-compiled server ZIP from: {}\n\
            2. Extract the files and place 'llama-server.exe' (or 'llama-server' binary) inside the 'bin' folder located at the root of 'swarm-studio/'.\n\
            3. Refresh settings to see it marked as Available!",
            response.status(), url
        ));
    }

    let total_size = response
        .content_length()
        .ok_or_else(|| "Failed to get content length from GitHub response".to_string())?;

    let temp_zip_path = zip_path.with_extension("downloading");
    let mut file = tokio::fs::File::create(&temp_zip_path).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= std::time::Duration::from_millis(200) || downloaded == total_size {
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            let speed_mbps = if elapsed_secs > 0.0 {
                (downloaded as f64 / 1024.0 / 1024.0) / elapsed_secs
            } else {
                0.0
            };

            let progress = DownloadProgress {
                model_id: "llama-server".to_string(),
                downloaded_bytes: downloaded,
                total_bytes: total_size,
                speed_mbps,
            };
            let _ = app_handle.emit("download-progress", &progress);
            last_emit = std::time::Instant::now();
        }
    }

    // Rename temp zip file to final zip file path
    if zip_path.exists() {
        let _ = fs::remove_file(&zip_path);
    }
    tokio::fs::rename(&temp_zip_path, &zip_path).await.map_err(|e| e.to_string())?;

    println!("Successfully downloaded llama_server.zip, initiating extraction...");

    // Extract using modern 'tar' command if available (Windows 10+), otherwise fallback to PowerShell
    #[cfg(target_os = "windows")]
    {
        let abs_zip = fs::canonicalize(&zip_path).map_err(|e| e.to_string())?;
        let abs_bin = fs::canonicalize(&bin_dir).map_err(|e| e.to_string())?;
        
        // 1. Try 'tar' first (standard on modern Windows 10/11, much more reliable than Expand-Archive)
        println!("Attempting extraction via tar: {} -> {}", abs_zip.display(), abs_bin.display());
        let tar_status = Command::new("tar")
            .arg("-xf")
            .arg(&abs_zip)
            .arg("-C")
            .arg(&abs_bin)
            .status();

        if let Ok(s) = tar_status {
            if s.success() {
                println!("Successfully extracted llama_server.zip via tar");
                return Ok("Download and extraction complete".to_string());
            }
        }

        // 2. Fallback to PowerShell if tar failed or is missing
        println!("Tar extraction failed or unavailable, falling back to PowerShell...");
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy").arg("Bypass")
            .arg("-Command")
            .arg(format!("$ErrorActionPreference = 'Stop'; Expand-Archive -Path '{}' -DestinationPath '{}' -Force", abs_zip.display(), abs_bin.display()))
            .output(); // Use output() instead of status() to capture error messages
        
        match output {
            Ok(out) => {
                if out.status.success() {
                    println!("Successfully extracted llama_server.zip via PowerShell");
                } else {
                    let err_msg = String::from_utf8_lossy(&out.stderr);
                    return Err(format!("Extraction failed. PowerShell Error: {}. \n\nPlease ensure you have enough disk space and no other process is using the folder.", err_msg));
                }
            },
            Err(e) => {
                return Err(format!("Failed to launch extraction engine: {}. Please ensure PowerShell or 'tar' is available.", e));
            }
        }
    }

    
    // For Unix/macOS, we could use unzip command
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("unzip")
            .arg("-o")
            .arg("../bin/llama_server.zip")
            .arg("-d")
            .arg("../bin")
            .status();
        if let Ok(status) = status {
            if status.success() {
                println!("Successfully extracted llama_server.zip");
            }
        }
    }
    
    Ok("Download complete".to_string())
}

#[tauri::command]
async fn start_llama_server(
    model_path: String,
    role: String,
    gpu_layers: u32,
    context_length: u32,
    state: State<'_, LlamaServerState>,
) -> Result<String, String> {
    // 1. Process-Level VRAM Eviction: Kill existing server before starting a new one
    {
        let mut process_guard = state.process.lock().unwrap();
        if let Some(mut child) = process_guard.take() {
            println!("Terminating existing llama-server to free VRAM...");
            let _ = child.kill();
            let _ = child.wait(); // Block until fully closed
            
            // NVML Polling logic would go here to ensure VRAM is actually dropped by the driver.
            // For now, we rely on the OS process cleanup.
        }
    }

    // 2. Asymmetric KV Cache configuration
    let cache_type = if role == "supervisor" {
        "q8_0" // 8-bit cache to save massive VRAM for the 7B MoE
    } else {
        "f16"  // FP16 cache to protect the fragile reasoning of the 0.5B worker
    };

    // Verify model file exists in either models folder
    let mut actual_model_path = PathBuf::from(&model_path);
    if !actual_model_path.exists() {
        // Try prepending parent directory relative path (root models/)
        let parent_model_path = PathBuf::from("..").join(&model_path);
        if parent_model_path.exists() {
            actual_model_path = parent_model_path;
        } else {
            // Try inside local src-tauri/models folder
            let mut stripped_path = model_path.clone();
            if stripped_path.starts_with("models/") {
                stripped_path = stripped_path.replace("models/", "");
            }
            let local_tauri_model_path = PathBuf::from("models").join(&stripped_path);
            if local_tauri_model_path.exists() {
                actual_model_path = local_tauri_model_path;
            } else {
                return Err(format!("Model file not found: {}. Please download it from the marketplace first.", model_path));
            }
        }
    }

    // The path to the executable (assuming we unzipped it into bin/)
    let exe_path = PathBuf::from("..").join("bin").join("llama-server.exe");
    
    if !exe_path.exists() {
        return Err("Local inference engine (llama-server.exe) not found. Please run the Automated Setup in Settings.".to_string());
    }

    // Spawn the child process
    let child = Command::new(exe_path)
        .arg("-m")
        .arg(&actual_model_path)
        .arg("-c")
        .arg(context_length.to_string())
        .arg("-ngl")
        .arg(gpu_layers.to_string())
        .arg("--cache-type")
        .arg(cache_type)
        .arg("--port")
        .arg("8080") // The frontend will communicate via localhost:8080/v1/chat/completions
        .spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {}", e))?;

    // Store the new process handle in Tauri's global state
    *state.process.lock().unwrap() = Some(child);

    Ok(format!("Started {} on port 8080 (Cache: {})", role, cache_type))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LlamaServerState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_hardware_info, 
            download_llama_server,
            download_model,
            start_llama_server,
            get_local_models,
            check_server_binary,
            delete_local_model,
            install_system_dependency,
            check_system_dependency
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
