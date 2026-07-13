use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

async fn serve_once(response: Vec<u8>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 2048];
        let _ = socket.read(&mut request).await;
        socket.write_all(&response).await.unwrap();
        socket.shutdown().await.unwrap();
    });
    format!("http://{address}")
}

async fn fetch_fixture(response: Vec<u8>) -> Result<serde_json::Value, LyricsProviderError> {
    let url = serve_once(response).await;
    fetch_json("fixture", "search", reqwest::Client::new().get(url)).await
}

fn response(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
    let mut response = format!("HTTP/1.1 {status}\r\n{headers}\r\n").into_bytes();
    response.extend_from_slice(body);
    response
}

#[test]
fn accepts_response_chunk_at_exact_size_limit() {
    let mut body = vec![0; MAX_RESPONSE_BYTES - 1];

    append_limited_chunk("fake", "search", &mut body, &[1]).unwrap();

    assert_eq!(body.len(), MAX_RESPONSE_BYTES);
}

#[test]
fn rejects_response_chunk_over_size_limit_with_context() {
    let mut body = vec![0; MAX_RESPONSE_BYTES];

    let error = append_limited_chunk("fake", "lyrics", &mut body, &[1]).unwrap_err();

    assert_eq!(error.provider(), "fake");
    assert_eq!(error.stage(), "lyrics.response_size");
}

#[tokio::test]
async fn rejects_http_error_statuses_with_context() {
    for status in ["404 Not Found", "500 Internal Server Error"] {
        let error =
            fetch_fixture(response(status, "Content-Length: 0\r\n", b"")).await.unwrap_err();
        assert_eq!(error.provider(), "fixture");
        assert_eq!(error.stage(), "search.status");
    }
}

#[tokio::test]
async fn rejects_content_length_over_limit_before_reading_body() {
    let headers = format!("Content-Length: {}\r\n", MAX_RESPONSE_BYTES + 1);

    let error = fetch_fixture(response("200 OK", &headers, b"")).await.unwrap_err();

    assert_eq!(error.stage(), "search.response_size");
}

#[tokio::test]
async fn rejects_streamed_body_that_accumulates_over_limit() {
    let body = vec![b'a'; MAX_RESPONSE_BYTES + 1];
    let fixture = response("200 OK", "Connection: close\r\n", &body);

    let error = fetch_fixture(fixture).await.unwrap_err();

    assert_eq!(error.provider(), "fixture");
    assert_eq!(error.stage(), "search.response_size");
}

#[tokio::test]
async fn rejects_malformed_json_with_context() {
    let body = b"{not-json}";
    let headers = format!("Content-Length: {}\r\n", body.len());

    let error = fetch_fixture(response("200 OK", &headers, body)).await.unwrap_err();

    assert_eq!(error.provider(), "fixture");
    assert_eq!(error.stage(), "search.parse");
}
