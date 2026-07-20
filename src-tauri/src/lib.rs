use std::io::{ErrorKind, Read, Write};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

struct SerialState(Mutex<Option<Box<dyn serialport::SerialPort>>>);

#[derive(Serialize)]
struct PortInfo {
    name: String,
    kind: String,
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| {
            let kind = match p.port_type {
                serialport::SerialPortType::UsbPort(_) => "USB".to_string(),
                serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
                serialport::SerialPortType::PciPort => "PCI".to_string(),
                serialport::SerialPortType::Unknown => "Unknown".to_string(),
            };
            PortInfo {
                name: p.port_name,
                kind,
            }
        })
        .collect())
}

#[tauri::command]
fn serial_open(
    state: State<'_, SerialState>,
    port: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: String,
) -> Result<(), String> {
    let parity = match parity.as_str() {
        "none" => serialport::Parity::None,
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => return Err(format!("Invalid parity: {}", parity)),
    };
    let data_bits = match data_bits {
        7 => serialport::DataBits::Seven,
        8 => serialport::DataBits::Eight,
        _ => return Err(format!("Invalid data bits: {}", data_bits)),
    };
    let stop_bits = match stop_bits {
        1 => serialport::StopBits::One,
        2 => serialport::StopBits::Two,
        _ => return Err(format!("Invalid stop bits: {}", stop_bits)),
    };
    let p = serialport::new(&port, baud_rate)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(p);
    Ok(())
}

#[tauri::command]
fn serial_close(state: State<'_, SerialState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn serial_transfer(
    state: State<'_, SerialState>,
    data: Vec<u8>,
    expected_len: usize,
    timeout_ms: u64,
) -> Result<Vec<u8>, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let port = guard
        .as_mut()
        .ok_or_else(|| "Port not open".to_string())?;

    port.write_all(&data)
        .map_err(|e| format!("Write failed: {}", e))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut buf = vec![0u8; expected_len];
    let mut filled = 0usize;
    while filled < expected_len {
        match port.read(&mut buf[filled..]) {
            Ok(0) => {}
            Ok(n) => filled += n,
            Err(e) if e.kind() == ErrorKind::TimedOut => {}
            Err(e) => {
                let _ = drain(port);
                return Err(format!("Read failed: {}", e));
            }
        }
        if Instant::now() >= deadline {
            let _ = drain(port);
            return Err(format!(
                "Timeout after {}ms (filled {}/{})",
                timeout_ms, filled, expected_len
            ));
        }
    }
    buf.truncate(filled);
    Ok(buf)
}

fn drain(port: &mut Box<dyn serialport::SerialPort>) -> std::io::Result<()> {
    let mut tmp = [0u8; 256];
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(50) {
        match port.read(&mut tmp) {
            Ok(0) => return Ok(()),
            Ok(_) => continue,
            Err(e) if e.kind() == ErrorKind::TimedOut => return Ok(()),
            Err(_) => return Ok(()),
        }
    }
    Ok(())
}

#[tauri::command]
fn tsv_create_file(path: String) -> Result<(), String> {
    std::fs::File::create(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn tsv_append(path: String, data: String) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(SerialState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            serial_open,
            serial_close,
            serial_transfer,
            tsv_create_file,
            tsv_append,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
