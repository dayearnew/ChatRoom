use std::mem::size_of;
use std::thread::sleep;
use std::time::Duration;

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, VkKeyScanW, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_LWIN, VK_MENU,
    VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

use crate::accessibility::Accessibility;
use crate::models::{ActionExecution, ComputerAction, ExecutionMode, NativeError, PointValue};

pub struct Input;

impl Input {
    pub fn perform(
        &self,
        accessibility: &Accessibility,
        action: &ComputerAction,
    ) -> Result<ActionExecution, NativeError> {
        match action {
            ComputerAction::Move { x, y } => {
                move_cursor(*x, *y)?;
                foreground(false)
            }
            ComputerAction::Click { x, y, element_id } => {
                if let Some(id) = element_id {
                    if accessibility.invoke(*id).is_ok() {
                        return semantic(false);
                    }
                }
                click(target(accessibility, *element_id, *x, *y)?, false, 1)?;
                foreground(true)
            }
            ComputerAction::DoubleClick { x, y, element_id } => {
                click(target(accessibility, *element_id, *x, *y)?, false, 2)?;
                foreground(true)
            }
            ComputerAction::RightClick { x, y, element_id } => {
                click(target(accessibility, *element_id, *x, *y)?, true, 1)?;
                foreground(true)
            }
            ComputerAction::Drag {
                from,
                to,
                duration_ms,
            } => {
                drag(*from, *to, duration_ms.unwrap_or(0).min(10_000))?;
                foreground(true)
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                element_id,
            } => {
                if let Some(id) = element_id {
                    let rect = accessibility.rect(*id)?;
                    move_cursor(
                        (rect.x + rect.width / 2) as f64,
                        (rect.y + rect.height / 2) as f64,
                    )?;
                }
                scroll(delta_x.unwrap_or(0.0), *delta_y)?;
                foreground(false)
            }
            ComputerAction::Keypress { keys } => {
                keypress(keys)?;
                foreground(true)
            }
            ComputerAction::TypeText { text, element_id } => {
                if let Some(id) = element_id {
                    if accessibility.set_value(*id, text).is_ok() {
                        return semantic(false);
                    }
                    accessibility.focus(*id)?;
                }
                type_text(text)?;
                foreground(true)
            }
            ComputerAction::Invoke { element_id } => {
                accessibility.invoke(*element_id)?;
                semantic(false)
            }
            ComputerAction::SetValue { element_id, value } => {
                accessibility.set_value(*element_id, value)?;
                semantic(false)
            }
            ComputerAction::SelectText {
                element_id,
                start,
                length,
            } => {
                accessibility.select_text(*element_id, *start, *length)?;
                semantic(false)
            }
            ComputerAction::ActivateApp { app } => {
                accessibility.activate_application(app)?;
                foreground(true)
            }
            ComputerAction::ActivateWindow { element_id } => {
                accessibility.activate_window(*element_id)?;
                semantic(true)
            }
            ComputerAction::MoveWindow { element_id, x, y } => {
                accessibility.move_window(*element_id, *x, *y)?;
                semantic(false)
            }
            ComputerAction::ResizeWindow {
                element_id,
                width,
                height,
            } => {
                accessibility.resize_window(*element_id, *width, *height)?;
                semantic(false)
            }
            ComputerAction::Wait { ms } => {
                sleep(Duration::from_millis((*ms).min(30_000)));
                Ok(ActionExecution {
                    mode: ExecutionMode::Background,
                    focus_changed: false,
                })
            }
        }
    }
}

fn semantic(focus_changed: bool) -> Result<ActionExecution, NativeError> {
    Ok(ActionExecution {
        mode: ExecutionMode::Semantic,
        focus_changed,
    })
}

fn foreground(focus_changed: bool) -> Result<ActionExecution, NativeError> {
    Ok(ActionExecution {
        mode: ExecutionMode::Foreground,
        focus_changed,
    })
}

fn target(
    accessibility: &Accessibility,
    element_id: Option<i32>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<PointValue, NativeError> {
    if let Some(id) = element_id {
        let rect = accessibility.rect(id)?;
        return Ok(PointValue {
            x: (rect.x + rect.width / 2) as f64,
            y: (rect.y + rect.height / 2) as f64,
        });
    }
    match (x, y) {
        (Some(x), Some(y)) => Ok(PointValue { x, y }),
        _ => Err(NativeError::invalid(
            "Mouse action requires elementId or x/y coordinates",
        )),
    }
}

fn move_cursor(x: f64, y: f64) -> Result<(), NativeError> {
    unsafe {
        SetCursorPos(x.round() as i32, y.round() as i32)?;
    }
    Ok(())
}

fn click(point: PointValue, right: bool, count: usize) -> Result<(), NativeError> {
    move_cursor(point.x, point.y)?;
    let (down, up) = if right {
        (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
    } else {
        (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    };
    for _ in 0..count {
        send(&[mouse_input(down, 0), mouse_input(up, 0)])?;
    }
    Ok(())
}

fn drag(from: PointValue, to: PointValue, duration_ms: u64) -> Result<(), NativeError> {
    move_cursor(from.x, from.y)?;
    send(&[mouse_input(MOUSEEVENTF_LEFTDOWN, 0)])?;
    let steps = if duration_ms == 0 {
        1
    } else {
        ((duration_ms / 16).clamp(2, 60)) as usize
    };
    for step in 1..=steps {
        let progress = step as f64 / steps as f64;
        move_cursor(
            from.x + (to.x - from.x) * progress,
            from.y + (to.y - from.y) * progress,
        )?;
        if duration_ms > 0 {
            sleep(Duration::from_millis(duration_ms / steps as u64));
        }
    }
    send(&[mouse_input(MOUSEEVENTF_LEFTUP, 0)])?;
    Ok(())
}

fn scroll(delta_x: f64, delta_y: f64) -> Result<(), NativeError> {
    let mut inputs = Vec::with_capacity(2);
    if delta_y != 0.0 {
        inputs.push(mouse_input(
            MOUSEEVENTF_WHEEL,
            delta_y.round() as i32 as u32,
        ));
    }
    if delta_x != 0.0 {
        inputs.push(mouse_input(
            MOUSEEVENTF_HWHEEL,
            delta_x.round() as i32 as u32,
        ));
    }
    if !inputs.is_empty() {
        send(&inputs)?;
    }
    Ok(())
}

fn keypress(keys: &[String]) -> Result<(), NativeError> {
    if keys.is_empty() {
        return Err(NativeError::invalid("Keypress requires at least one key"));
    }
    let mut modifiers = Vec::new();
    let mut main = None;
    for key in keys {
        if let Some(value) = modifier(key) {
            modifiers.push(value);
        } else if main.is_none() {
            main = key_code(key);
        } else {
            return Err(NativeError::invalid(
                "Keypress supports one non-modifier key",
            ));
        }
    }
    let main = main.ok_or_else(|| NativeError::invalid("Unsupported key combination"))?;
    let mut inputs = Vec::with_capacity(modifiers.len() * 2 + 2);
    for key in &modifiers {
        inputs.push(key_input(*key, false));
    }
    inputs.push(key_input(main, false));
    inputs.push(key_input(main, true));
    for key in modifiers.iter().rev() {
        inputs.push(key_input(*key, true));
    }
    send(&inputs)
}

fn type_text(text: &str) -> Result<(), NativeError> {
    let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2);
    for unit in text.encode_utf16() {
        inputs.push(unicode_input(unit, false));
        inputs.push(unicode_input(unit, true));
    }
    if inputs.is_empty() {
        return Ok(());
    }
    send(&inputs)
}

fn modifier(raw: &str) -> Option<VIRTUAL_KEY> {
    match raw.to_ascii_uppercase().as_str() {
        "CTRL" | "CONTROL" => Some(VK_CONTROL),
        "ALT" | "OPTION" => Some(VK_MENU),
        "SHIFT" => Some(VK_SHIFT),
        "META" | "CMD" | "COMMAND" | "WIN" => Some(VK_LWIN),
        _ => None,
    }
}

fn key_code(raw: &str) -> Option<VIRTUAL_KEY> {
    match raw.to_ascii_uppercase().as_str() {
        "ENTER" | "RETURN" => Some(VK_RETURN),
        "TAB" => Some(VK_TAB),
        "SPACE" => Some(VK_SPACE),
        "ESC" | "ESCAPE" => Some(VK_ESCAPE),
        "BACKSPACE" => Some(VK_BACK),
        "DELETE" => Some(VK_DELETE),
        "LEFT" => Some(VK_LEFT),
        "RIGHT" => Some(VK_RIGHT),
        "UP" => Some(VK_UP),
        "DOWN" => Some(VK_DOWN),
        value if value.encode_utf16().count() == 1 => {
            let unit = value.encode_utf16().next()?;
            let code = unsafe { VkKeyScanW(unit) };
            if code == -1 {
                None
            } else {
                Some(VIRTUAL_KEY((code as u16) & 0xff))
            }
        }
        _ => None,
    }
}

fn mouse_input(
    flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
    data: u32,
) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                mouseData: data,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}

fn key_input(key: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wScan: unit,
                dwFlags: if up {
                    KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                } else {
                    KEYEVENTF_UNICODE
                },
                ..Default::default()
            },
        },
    }
}

fn send(inputs: &[INPUT]) -> Result<(), NativeError> {
    let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(NativeError::internal(format!(
            "SendInput wrote {sent} of {} events",
            inputs.len()
        )));
    }
    Ok(())
}
