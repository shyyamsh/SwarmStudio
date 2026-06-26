fn main() {
    #[cfg(windows)]
    {
        // Only require administrator privileges for the final release build.
        // This prevents development cycle issues (like port conflicts or UAC prompts)
        // when running 'npm run tauri dev' from a normal terminal.
        if std::env::var("PROFILE").unwrap_or_default() == "release" {
            embed_resource::compile("admin.rc", embed_resource::NONE);
        }
    }

    tauri_build::build()
}
