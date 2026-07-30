$taskPreviousTauriConfig = $env:TAURI_CONFIG
$env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
$taskExitCode = 1

try {
  & cargo build --manifest-path src-tauri/Cargo.toml --release --bin codepulse-codex-bridge --features bridge-bin
  $taskExitCode = $LASTEXITCODE
} finally {
  $env:TAURI_CONFIG = $taskPreviousTauriConfig
}

exit $taskExitCode
