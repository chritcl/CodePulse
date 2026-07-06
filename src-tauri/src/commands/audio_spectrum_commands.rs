/**
 * 音频频谱命令
 *
 * 使用 Windows WASAPI loopback 采集系统输出音频，
 * 通过 FFT 分析转换为灵动岛使用的 5 段频谱高度。
 */
use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Mutex;
use std::thread;

/// 频谱最低高度，与前端收起状态保持一致
const MIN_BAR_SCALE: f32 = 0.35;

/// 频谱最高高度，避免柱子撑出灵动岛
const MAX_BAR_SCALE: f32 = 0.95;

/// 全局频谱缓存
static SPECTRUM: Mutex<[f32; 5]> = Mutex::new([MIN_BAR_SCALE; 5]);

#[derive(Clone, Copy)]
enum CaptureSampleFormat {
    F32,
    I16,
}

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

/// 启动 WASAPI loopback 音频频谱监听
pub fn start_audio_spectrum_monitor() {
    thread::spawn(|| {
        if let Err(err) = run_loopback_capture() {
            eprintln!("[NSD] 频谱采集线程异常退出: {}", err);
        }
    });
}

/// 执行 WASAPI loopback 采集主循环
fn run_loopback_capture() -> Result<(), String> {
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    // 初始化 COM
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|e| format!("CoInitializeEx 失败: {:?}", e))?;

    // 获取默认音频输出设备
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|e| format!("创建设备枚举器失败: {:?}", e))?;

    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
        .map_err(|e| format!("获取默认输出设备失败: {:?}", e))?;

    let audio_client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }
        .map_err(|e| format!("激活音频客户端失败: {:?}", e))?;

    // 获取混合格式
    let format_ptr = unsafe { audio_client.GetMixFormat() }
        .map_err(|e| format!("GetMixFormat 失败: {:?}", e))?;

    if format_ptr.is_null() {
        return Err("GetMixFormat 返回空指针".into());
    }

    let format = unsafe { *format_ptr };
    let sample_rate = format.nSamplesPerSec;
    let bits_per_sample = format.wBitsPerSample;
    let channels = format.nChannels as usize;
    let sample_format = match detect_capture_sample_format(format_ptr, &format) {
        Ok(sample_format) => sample_format,
        Err(err) => {
            unsafe { CoTaskMemFree(Some(format_ptr.cast())) };
            return Err(err);
        }
    };

    eprintln!(
        "[NSD] 音频设备就绪: {}Hz / {}bit / {}ch",
        sample_rate, bits_per_sample, channels
    );

    // 初始化 loopback 采集流
    let buffer_duration: i64 = 100 * 10000; // 100ms
    let init_result = unsafe {
        audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            buffer_duration,
            0i64,
            format_ptr,
            None,
        )
    };
    // GetMixFormat 返回的内存由 COM 分配，Initialize 之后即可释放。
    unsafe { CoTaskMemFree(Some(format_ptr.cast())) };
    init_result.map_err(|e| format!("Initialize loopback 失败: {:?}", e))?;

    let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
        .map_err(|e| format!("GetService IAudioCaptureClient 失败: {:?}", e))?;

    unsafe { audio_client.Start() }.map_err(|e| format!("IAudioClient::Start 失败: {:?}", e))?;

    eprintln!("[NSD] WASAPI loopback 采集已启动");

    // 采集循环
    loop {
        thread::sleep(std::time::Duration::from_millis(16));

        // 消费所有可用的数据包
        loop {
            let packet_size = match unsafe { capture_client.GetNextPacketSize() } {
                Ok(n) => n,
                Err(_) => break,
            };

            if packet_size == 0 {
                break;
            }

            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut num_frames: u32 = 0;
            let mut flags: u32 = 0;

            if unsafe {
                capture_client.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
            }
            .is_err()
            {
                break;
            }

            if data_ptr.is_null() || num_frames == 0 {
                let _ = unsafe { capture_client.ReleaseBuffer(0) };
                continue;
            }

            // AUDCLNT_BUFFERFLAGS_SILENT = 0x1
            let is_silent = (flags & 0x1) != 0;

            let frame_count = num_frames as usize;
            let total_samples = frame_count * channels;

            if is_silent {
                update_spectrum([MIN_BAR_SCALE; 5]);
                let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
                continue;
            }

            let samples = match sample_format {
                CaptureSampleFormat::F32 => {
                    let raw = unsafe {
                        std::slice::from_raw_parts(data_ptr as *const f32, total_samples)
                    };
                    to_mono_f32(raw, channels)
                }
                CaptureSampleFormat::I16 => {
                    let raw = unsafe {
                        std::slice::from_raw_parts(data_ptr as *const i16, total_samples)
                    };
                    let f: Vec<f32> = raw.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    to_mono_f32(&f, channels)
                }
            };

            compute_spectrum(&samples, sample_rate);
            let _ = unsafe { capture_client.ReleaseBuffer(num_frames) };
        }
    }
}

fn detect_capture_sample_format(
    format_ptr: *const windows::Win32::Media::Audio::WAVEFORMATEX,
    format: &windows::Win32::Media::Audio::WAVEFORMATEX,
) -> Result<CaptureSampleFormat, String> {
    use windows::Win32::Media::Audio::{WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM};
    use windows::Win32::Media::Multimedia::{
        KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT,
    };

    const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
    const KSDATAFORMAT_SUBTYPE_PCM: windows::core::GUID =
        windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);

    let format_tag = format.wFormatTag;
    let bits_per_sample = format.wBitsPerSample;
    let cb_size = format.cbSize;

    if format_tag == WAVE_FORMAT_PCM as u16 && bits_per_sample == 16 {
        return Ok(CaptureSampleFormat::I16);
    }

    if format_tag == WAVE_FORMAT_IEEE_FLOAT as u16 && bits_per_sample == 32 {
        return Ok(CaptureSampleFormat::F32);
    }

    if format_tag == WAVE_FORMAT_EXTENSIBLE_TAG {
        let min_extensible_size = (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
            - std::mem::size_of::<WAVEFORMATEX>()) as u16;
        if cb_size < min_extensible_size {
            return Err("WAVEFORMATEXTENSIBLE 扩展数据长度不足".into());
        }

        let extensible = unsafe { *(format_ptr as *const WAVEFORMATEXTENSIBLE) };
        let sub_format = extensible.SubFormat;

        if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT && bits_per_sample == 32 {
            return Ok(CaptureSampleFormat::F32);
        }

        if sub_format == KSDATAFORMAT_SUBTYPE_PCM && bits_per_sample == 16 {
            return Ok(CaptureSampleFormat::I16);
        }
    }

    Err(format!(
        "暂不支持的音频格式: tag={} bits={}",
        format_tag, bits_per_sample
    ))
}

/// 多声道转单声道
fn to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|ch| ch.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// 对单声道采样做 FFT，返回 5 段频谱高度
fn calculate_spectrum(samples: &[f32], sample_rate: u32) -> [f32; 5] {
    if samples.len() < 128 || sample_rate == 0 {
        return [MIN_BAR_SCALE; 5];
    }

    let fft_size = samples.len().next_power_of_two().min(4096);
    let input_len = samples.len().min(fft_size);
    let chunk = &samples[..input_len];

    let max_sample = chunk.iter().copied().map(f32::abs).fold(0.0, f32::max);
    if max_sample < 0.0005 {
        return [MIN_BAR_SCALE; 5];
    }

    // 汉宁窗 + FFT
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(fft_size);
    let mut buf: Vec<Complex<f32>> = (0..fft_size)
        .map(|i| {
            let value = samples.get(i).copied().unwrap_or(0.0);
            let w = 0.5
                * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (fft_size as f32 - 1.0)).cos());
            Complex {
                re: value * w,
                im: 0.0,
            }
        })
        .collect();

    fft.process(&mut buf);

    // 按频率范围分为 5 段：20-150Hz / 150-500Hz / 500-2kHz / 2k-6kHz / 6k-20kHz
    let freq_per_bin = sample_rate as f32 / fft_size as f32;
    let boundaries = [150.0, 500.0, 2000.0, 6000.0];

    let mut peak = [0.0f32; 5];
    let mut sum_square = [0.0f32; 5];
    let mut counts = [0u32; 5];

    for (i, c) in buf.iter().enumerate().take(fft_size / 2).skip(1) {
        let freq = i as f32 * freq_per_bin;
        if !(20.0..=20_000.0).contains(&freq) {
            continue;
        }

        let mag = (c.re * c.re + c.im * c.im).sqrt() / fft_size as f32;

        let bin = if freq < boundaries[0] {
            0
        } else if freq < boundaries[1] {
            1
        } else if freq < boundaries[2] {
            2
        } else if freq < boundaries[3] {
            3
        } else {
            4
        };

        peak[bin] = peak[bin].max(mag);
        sum_square[bin] += mag * mag;
        counts[bin] += 1;
    }

    // 峰值保证窄频率也能抬升，RMS 保留整体能量。
    let mut next = [MIN_BAR_SCALE; 5];
    let eq_weights = [1.35, 1.15, 1.25, 1.55, 2.0];
    for i in 0..5 {
        let rms = if counts[i] > 0 {
            (sum_square[i] / counts[i] as f32).sqrt()
        } else {
            0.0
        };

        let energy = (peak[i] * 0.75 + rms * 0.25) * eq_weights[i] * 36.0;
        let scaled = if energy > 0.0008 {
            ((energy + 1.0).log10() * 0.48) + MIN_BAR_SCALE
        } else {
            MIN_BAR_SCALE
        };
        next[i] = scaled.clamp(MIN_BAR_SCALE, MAX_BAR_SCALE);
    }

    next
}

/// 平滑并限制频谱高度
fn smooth_spectrum(current: &mut [f32; 5], next: [f32; 5]) {
    for i in 0..5 {
        let old = current[i].clamp(MIN_BAR_SCALE, MAX_BAR_SCALE);
        let next = next[i].clamp(MIN_BAR_SCALE, MAX_BAR_SCALE);
        current[i] = (old * 0.65 + next * 0.35).clamp(MIN_BAR_SCALE, MAX_BAR_SCALE);
    }
}

/// 写入全局频谱缓存
fn update_spectrum(next: [f32; 5]) {
    // 平滑过渡：35% 新值 + 65% 旧值
    if let Ok(mut spectrum) = SPECTRUM.lock() {
        smooth_spectrum(&mut spectrum, next);
    }
}

/// 对单声道采样做 FFT，写入全局 SPECTRUM
fn compute_spectrum(samples: &[f32], sample_rate: u32) {
    update_spectrum(calculate_spectrum(samples, sample_rate));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_wave(freq: f32, sample_rate: u32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (2.0 * std::f32::consts::PI * freq * t).sin() * 0.6
            })
            .collect()
    }

    fn max_index(values: &[f32; 5]) -> usize {
        values
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.total_cmp(b))
            .map(|(index, _)| index)
            .unwrap_or(0)
    }

    #[test]
    fn 静音输入返回最低频谱() {
        let samples = vec![0.0; 4096];

        let spectrum = calculate_spectrum(&samples, 48_000);

        assert_eq!(spectrum, [MIN_BAR_SCALE; 5]);
    }

    #[test]
    fn 低频正弦波主要抬升第一段() {
        let samples = sine_wave(100.0, 48_000, 4096);

        let spectrum = calculate_spectrum(&samples, 48_000);

        assert_eq!(max_index(&spectrum), 0);
        assert!(spectrum[0] > MIN_BAR_SCALE + 0.05);
    }

    #[test]
    fn 中频正弦波主要抬升第三段() {
        let samples = sine_wave(1000.0, 48_000, 4096);

        let spectrum = calculate_spectrum(&samples, 48_000);

        assert_eq!(max_index(&spectrum), 2);
        assert!(spectrum[2] > MIN_BAR_SCALE + 0.05);
    }

    #[test]
    fn 平滑结果保持在显示范围内() {
        let mut current = [0.9, 0.2, 0.6, 1.4, 0.4];

        smooth_spectrum(&mut current, [1.4, -0.2, 0.8, 2.0, 0.1]);

        assert!(current
            .iter()
            .all(|value| (*value >= MIN_BAR_SCALE) && (*value <= MAX_BAR_SCALE)));
    }
}
