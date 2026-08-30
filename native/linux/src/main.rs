mod accessibility;
mod input;
mod keyboard;
mod models;
mod protocol;
mod session;
mod x11;

use crate::models::NativeError;
use crate::session::ComputerSession;

fn main() {
    if let Err(error) = run() {
        eprintln!("[computer-helper] {}: {}", error.code, error.message);
        std::process::exit(1);
    }
}

fn run() -> Result<(), NativeError> {
    let mut session = ComputerSession::new()?;
    protocol::run(&mut session)
}
