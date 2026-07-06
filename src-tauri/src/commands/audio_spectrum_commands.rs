/**
 * 音频频谱命令
 *
 * 采集系统输出音频并转换为灵动岛使用的 5 段频谱高度。
 */
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Mutex;
use std::thread;

/// 频谱最低高度，与前端收起状态保持一致
const MIN_BAR_SCALE: f32 = 0.35;

/// 频谱最高高度，避免柱子撑出灵动岛
const MAX_BAR_SCALE: f32 = 0.95;

/// 全局频谱缓存
static SPECTRUM: Mutex<[f32; 5]> = Mutex::new([MIN_BAR_SCALE; 5]);

/// 获取当前音频频谱
#[tauri::command]
pub fn get_audio_spectrum() -> [f32; 5] {
    match SPECTRUM.lock() {
        Ok(spectrum) => *spectrum,
        Err(err) => {
            eprintln!("[NSD] 获取音频频谱失败: {}", err);
            [MIN_BAR_SCALE; 5]
        }
    }
}

/// 启动音频频谱监听
pub fn start_audio_spectrum_monitor() {
    thread::spawn(|| {
        let host = cpal::default_host();
        let device = match host.default_output_device() {
            Some(device) => device,
            None => return,
        };

        let supported_config = match device.default_output_config() {
            Ok(config) => config,
            Err(_) => return,
        };

        let sample_format = supported_config.sample_format();
        let config: cpal::StreamConfig = supported_config.into();
        let channels = config.channels;
        let err_fn = |err| eprintln!("[NSD] 音频采集失败: {}", err);

        let stream = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _| process_audio_data(data, channels),
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let samples: Vec<f32> =
                        data.iter().map(|sample| *sample as f32 / i16::MAX as f32).collect();
                    process_audio_data(&samples, channels);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let samples: Vec<f32> = data
                        .iter()
                        .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                        .collect();
                    process_audio_data(&samples, channels);
                },
                err_fn,
                None,
            ),
            _ => return,
        };

        if let Ok(stream) = stream {
            if stream.play().is_ok() {
                loop {
                    thread::sleep(std::time::Duration::from_secs(3600));
                }
            }
        }
    });
}

/// 将采样数据转换为 5 段频谱高度
fn process_audio_data(data: &[f32], channels: u16) {
    if data.is_empty() || channels == 0 {
        return;
    }

    let channel_count = channels as usize;
    let mut mono = Vec::with_capacity(data.len() / channel_count);
    for chunk in data.chunks(channel_count) {
        let sum: f32 = chunk.iter().copied().sum();
        mono.push(sum / channels as f32);
    }

    let sample_count = mono.len();
    if sample_count < 128 {
        return;
    }

    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(sample_count);
    let mut buffer: Vec<Complex<f32>> = mono
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let window = 0.5
                * (1.0
                    - (2.0 * std::f32::consts::PI * index as f32 / (sample_count - 1) as f32)
                        .cos());
            Complex {
                re: value * window,
                im: 0.0,
            }
        })
        .collect();

    fft.process(&mut buffer);

    let half_count = sample_count / 2;
    let mut bins = [0.0_f32; 5];

    for (index, sample) in buffer.iter().enumerate().take(half_count).skip(1) {
        let magnitude = (sample.re.powi(2) + sample.im.powi(2)).sqrt();
        let bin_index = if index < half_count / 16 {
            0
        } else if index < half_count / 8 {
            1
        } else if index < half_count / 4 {
            2
        } else if index < half_count / 2 {
            3
        } else {
            4
        };

        if magnitude > bins[bin_index] {
            bins[bin_index] = magnitude;
        }
    }

    let eq_weights = [1.2, 1.1, 1.5, 3.0, 5.0];
    let base_gain = 5.0;
    let mut next_spectrum = [MIN_BAR_SCALE; 5];

    for index in 0..5 {
        let energy = bins[index] * eq_weights[index] * base_gain;
        let scaled = ((energy + 1.0).log10() * 0.20) + MIN_BAR_SCALE;
        next_spectrum[index] = scaled.clamp(MIN_BAR_SCALE, MAX_BAR_SCALE);
    }

    if let Ok(mut spectrum) = SPECTRUM.lock() {
        for index in 0..5 {
            spectrum[index] = spectrum[index] * 0.6 + next_spectrum[index] * 0.4;
        }
    }
}
