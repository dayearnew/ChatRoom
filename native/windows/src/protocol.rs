use std::io::{BufRead, Write};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::models::{ActionRequest, NativeError, SnapshotRequest};
use crate::session::ComputerSession;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct RequestEnvelope {
    protocol: u32,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct SuccessEnvelope<T: Serialize> {
    protocol: u32,
    id: String,
    result: T,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: &'a str,
}

#[derive(Serialize)]
struct ErrorEnvelope<'a> {
    protocol: u32,
    id: &'a str,
    error: ErrorBody<'a>,
}

pub fn run(session: &mut ComputerSession) -> Result<(), NativeError> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        handle_line(session, &line, &mut stdout)?;
    }
    Ok(())
}

fn handle_line(
    session: &mut ComputerSession,
    line: &str,
    output: &mut impl Write,
) -> Result<(), NativeError> {
    let parsed = serde_json::from_str::<RequestEnvelope>(line);
    let request = match parsed {
        Ok(value) => value,
        Err(error) => {
            let id = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.get("id")?.as_str().map(str::to_owned))
                .unwrap_or_else(|| "unknown".to_owned());
            return write_error(
                output,
                &id,
                &NativeError::invalid(format!("Invalid protocol request: {error}")),
            );
        }
    };

    if request.protocol != PROTOCOL_VERSION {
        return write_error(
            output,
            &request.id,
            &NativeError::unsupported(format!(
                "Unsupported Computer protocol version: {}",
                request.protocol
            )),
        );
    }

    let result = match request.method.as_str() {
        "status" => write_result(output, &request.id, &session.status()),
        "snapshot" => decode::<SnapshotRequest>(request.params)
            .and_then(|params| session.snapshot(params))
            .and_then(|value| write_result(output, &request.id, &value)),
        "action" => decode::<ActionRequest>(request.params)
            .and_then(|params| session.action(params))
            .and_then(|value| write_result(output, &request.id, &value)),
        "requestPermission" => Err(NativeError::unsupported(
            "Windows does not require Computer Use permission requests",
        )),
        _ => Err(NativeError::unsupported(format!(
            "Unknown Computer protocol method: {}",
            request.method
        ))),
    };

    if let Err(error) = result {
        write_error(output, &request.id, &error)?;
    }
    Ok(())
}

fn decode<T: DeserializeOwned>(value: Value) -> Result<T, NativeError> {
    serde_json::from_value(value)
        .map_err(|error| NativeError::invalid(format!("Invalid request parameters: {error}")))
}

fn write_result<T: Serialize>(
    output: &mut impl Write,
    id: &str,
    result: &T,
) -> Result<(), NativeError> {
    let value = SuccessEnvelope {
        protocol: PROTOCOL_VERSION,
        id: id.to_owned(),
        result,
    };
    serde_json::to_writer(&mut *output, &value)
        .map_err(|error| NativeError::internal(error.to_string()))?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn write_error(output: &mut impl Write, id: &str, error: &NativeError) -> Result<(), NativeError> {
    let value = ErrorEnvelope {
        protocol: PROTOCOL_VERSION,
        id,
        error: ErrorBody {
            code: error.code,
            message: &error.message,
        },
    };
    serde_json::to_writer(&mut *output, &value)
        .map_err(|error| NativeError::internal(error.to_string()))?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}
