use netspeed_dynamic_lib::codex::bridge::{run_from_stdin, source_from_process_arguments};

#[tokio::main]
async fn main() {
    run_from_stdin(source_from_process_arguments()).await;
}
