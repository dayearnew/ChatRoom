use std::thread::sleep;
use std::time::Duration;

use crate::accessibility::Accessibility;
use crate::models::{
    ActionExecution, ComputerAction, ExecutionMode, NativeError, PointValue, RectValue,
};
use crate::x11::X11Controller;

pub struct Input;

impl Input {
    pub fn perform(
        &self,
        x11: &X11Controller,
        accessibility: &Accessibility,
        action: &ComputerAction,
        capture: Option<RectValue>,
    ) -> Result<ActionExecution, NativeError> {
        if let Some(element_id) = action.element_id() {
            ensure_element_on_current_workspace(x11, accessibility, element_id)?;
        }

        match action {
            ComputerAction::Move { x, y } => {
                x11.move_pointer(snapshot_point(PointValue { x: *x, y: *y }, capture))?;
                foreground(false)
            }
            ComputerAction::Click { x, y, element_id } => {
                if let Some(id) = element_id {
                    if accessibility.invoke(*id).is_ok() {
                        return semantic(false);
                    }
                }
                x11.click(target(accessibility, *element_id, *x, *y, capture)?, 1, 1)?;
                foreground(true)
            }
            ComputerAction::DoubleClick { x, y, element_id } => {
                x11.click(target(accessibility, *element_id, *x, *y, capture)?, 1, 2)?;
                foreground(true)
            }
            ComputerAction::RightClick { x, y, element_id } => {
                x11.click(target(accessibility, *element_id, *x, *y, capture)?, 3, 1)?;
                foreground(true)
            }
            ComputerAction::Drag {
                from,
                to,
                duration_ms,
            } => {
                x11.drag(
                    snapshot_point(*from, capture),
                    snapshot_point(*to, capture),
                    duration_ms.unwrap_or(0).min(10_000),
                )?;
                foreground(true)
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                element_id,
            } => {
                if let Some(id) = element_id {
                    let rect = accessibility.rect(*id)?;
                    x11.move_pointer(PointValue {
                        x: (rect.x + rect.width / 2) as f64,
                        y: (rect.y + rect.height / 2) as f64,
                    })?;
                }
                x11.scroll(delta_x.unwrap_or(0.0), *delta_y)?;
                foreground(false)
            }
            ComputerAction::Keypress { keys } => {
                x11.keypress(keys)?;
                foreground(true)
            }
            ComputerAction::TypeText { text, element_id } => {
                if let Some(id) = element_id {
                    if accessibility.set_value(*id, text).is_ok() {
                        return semantic(false);
                    }
                    accessibility.focus(*id)?;
                }
                x11.type_text(text)?;
                foreground(element_id.is_some())
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
                x11.activate_application(app)?;
                foreground(true)
            }
            ComputerAction::ActivateWindow { element_id } => {
                x11.activate_window(window_id(x11, accessibility, *element_id)?)?;
                foreground(true)
            }
            ComputerAction::MoveWindow { element_id, x, y } => {
                let point = snapshot_point(PointValue { x: *x, y: *y }, capture);
                x11.move_window(
                    window_id(x11, accessibility, *element_id)?,
                    point.x,
                    point.y,
                )?;
                foreground(false)
            }
            ComputerAction::ResizeWindow {
                element_id,
                width,
                height,
            } => {
                x11.resize_window(window_id(x11, accessibility, *element_id)?, *width, *height)?;
                foreground(false)
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

fn ensure_element_on_current_workspace(
    x11: &X11Controller,
    accessibility: &Accessibility,
    element_id: i32,
) -> Result<(), NativeError> {
    let pid = accessibility.process_id(element_id)?;
    if x11.current_window_pids()?.contains(&pid) {
        Ok(())
    } else {
        Err(NativeError::not_found(
            "Target element is not available on the current workspace",
        ))
    }
}

fn window_id(
    x11: &X11Controller,
    accessibility: &Accessibility,
    element_id: i32,
) -> Result<u32, NativeError> {
    let rect = accessibility.rect(element_id)?;
    let pid = accessibility.process_id(element_id)?;
    x11.window_for_rect_and_pid(rect, pid)?
        .map(|window| window.id)
        .ok_or_else(|| {
            NativeError::not_found("Target window is not available on the current workspace")
        })
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
    capture: Option<RectValue>,
) -> Result<PointValue, NativeError> {
    if let Some(id) = element_id {
        let rect = accessibility.rect(id)?;
        return Ok(PointValue {
            x: (rect.x + rect.width / 2) as f64,
            y: (rect.y + rect.height / 2) as f64,
        });
    }
    match (x, y) {
        (Some(x), Some(y)) => Ok(snapshot_point(PointValue { x, y }, capture)),
        _ => Err(NativeError::invalid(
            "Mouse action requires elementId or x/y coordinates",
        )),
    }
}

fn snapshot_point(point: PointValue, capture: Option<RectValue>) -> PointValue {
    match capture {
        Some(capture) => PointValue {
            x: point.x + capture.x as f64,
            y: point.y + capture.y as f64,
        },
        None => point,
    }
}
