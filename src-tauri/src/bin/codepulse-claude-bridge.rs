use codepulse_lib::claude::bridge::run_from_stdin;

#[tokio::main]
async fn main() {
    run_from_stdin().await;
}
