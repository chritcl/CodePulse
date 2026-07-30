fn main() {
    let bridge_resource = std::path::Path::new("target/release/codepulse-codex-bridge.exe");
    println!("cargo:rerun-if-changed={}", bridge_resource.display());
    if !bridge_resource.is_file() && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"resources":[]}}"#);
    }
    tauri_build::build()
}
