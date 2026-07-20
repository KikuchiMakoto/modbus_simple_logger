#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    modbus_simple_logger_lib::run();
}
