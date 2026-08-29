mod accessibility;
mod capture;
mod input;
mod models;
mod protocol;
mod session;

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

use crate::models::NativeError;
use crate::session::ComputerSession;

fn main() {
    if let Err(error) = run() {
        eprintln!("[computer-helper] {}: {}", error.code, error.message);
        std::process::exit(1);
    }
}

fn run() -> Result<(), NativeError> {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
    }
    let _com = ComApartment;
    let mut session = ComputerSession::new()?;
    protocol::run(&mut session)
}

struct ComApartment;
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
