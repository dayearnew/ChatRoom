use std::collections::HashSet;

use uuid::Uuid;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use crate::accessibility::{window_rect, Accessibility};
use crate::capture::Capture;
use crate::input::Input;
use crate::models::{
    ActionPayload, ActionRequest, DisplayInfo, ElementInfo, ExecutionMode, NativeError,
    PermissionStatus, PointValue, RectValue, SnapshotPayload, SnapshotRequest, SnapshotTarget,
    StatusPayload,
};

pub struct ComputerSession {
    accessibility: Accessibility,
    capture: Capture,
    input: Input,
    current_snapshot_id: Option<String>,
    current_capture: Option<RectValue>,
}

impl ComputerSession {
    pub fn new() -> Result<Self, NativeError> {
        Ok(Self {
            accessibility: Accessibility::new()?,
            capture: Capture,
            input: Input,
            current_snapshot_id: None,
            current_capture: None,
        })
    }

    pub fn status(&self) -> StatusPayload {
        StatusPayload {
            platform: "windows",
            helper: "running",
            permissions: PermissionStatus {
                accessibility: "not-required",
                screen_recording: "not-required",
            },
            displays: self.capture.displays().unwrap_or_default(),
        }
    }

    pub fn snapshot(&mut self, request: SnapshotRequest) -> Result<SnapshotPayload, NativeError> {
        let include_screenshot = request.include_screenshot.unwrap_or(true);
        let include_elements = request.include_elements.unwrap_or(true);
        self.current_snapshot_id = None;

        let resolved = self.resolve_target(request.target.as_ref())?;
        let mut elements = if include_elements {
            self.accessibility.collect(resolved.element_root)?
        } else {
            self.accessibility.reset_elements();
            Vec::new()
        };
        for element in &mut elements {
            make_relative(element, resolved.capture);
        }

        let (active_app, active_window) = self.accessibility.foreground_context();
        let cursor = cursor_relative(resolved.capture);
        let screenshot = if include_screenshot {
            Some(self.capture.screenshot(resolved.capture)?)
        } else {
            None
        };
        let snapshot_id = Uuid::new_v4().to_string().to_uppercase();
        self.current_snapshot_id = Some(snapshot_id.clone());
        self.current_capture = Some(resolved.capture);

        Ok(SnapshotPayload {
            snapshot_id,
            revision: request.revision.unwrap_or(0),
            display: resolved.display,
            active_app,
            active_window,
            cursor,
            elements,
            screenshot,
        })
    }

    pub fn action(&mut self, request: ActionRequest) -> Result<ActionPayload, NativeError> {
        if request.actions.is_empty() {
            return Err(NativeError::invalid(
                "Computer action requires at least one action",
            ));
        }
        let references_elements = request
            .actions
            .iter()
            .any(|action| action.element_id().is_some());
        if references_elements {
            let snapshot_id = request.snapshot_id.as_deref().ok_or_else(|| {
                NativeError::stale("Actions using elementId require the latest snapshotId")
            })?;
            if self.current_snapshot_id.as_deref() != Some(snapshot_id) {
                return Err(NativeError::stale(
                    "Computer snapshot is stale; take a new snapshot before acting",
                ));
            }
        } else if let Some(snapshot_id) = request.snapshot_id.as_deref() {
            if self.current_snapshot_id.as_deref() != Some(snapshot_id) {
                return Err(NativeError::stale(
                    "Computer snapshot is stale; take a new snapshot before acting",
                ));
            }
        }

        self.current_snapshot_id = None;
        let mut modes = HashSet::new();
        let mut focus_changed = false;
        for action in &request.actions {
            let execution = self.input.perform(&self.accessibility, action)?;
            modes.insert(execution.mode);
            focus_changed |= execution.focus_changed;
        }

        let revision = request.revision.unwrap_or(0);
        let snapshot = if request.observe_after.unwrap_or(true) {
            Some(self.snapshot(SnapshotRequest {
                revision: Some(revision),
                target: None,
                include_screenshot: Some(true),
                include_elements: Some(true),
            })?)
        } else {
            self.accessibility.reset_elements();
            self.current_capture = None;
            None
        };

        let execution_mode = if modes.len() > 1 {
            ExecutionMode::Mixed
        } else {
            modes
                .into_iter()
                .next()
                .unwrap_or(ExecutionMode::Background)
        };
        Ok(ActionPayload {
            success: true,
            revision,
            snapshot,
            execution_mode,
            focus_changed,
        })
    }

    fn resolve_target(
        &self,
        target: Option<&SnapshotTarget>,
    ) -> Result<ResolvedTarget, NativeError> {
        match target.unwrap_or(&SnapshotTarget::Desktop) {
            SnapshotTarget::Desktop => {
                let capture = self.capture.virtual_screen();
                let display = self.capture.display(None).ok().map(|value| value.info);
                Ok(ResolvedTarget {
                    capture,
                    display,
                    element_root: None,
                })
            }
            SnapshotTarget::Display { display_id } => {
                let display = self.capture.display(display_id.as_deref())?;
                Ok(ResolvedTarget {
                    capture: display.rect,
                    display: Some(display.info),
                    element_root: None,
                })
            }
            SnapshotTarget::Region {
                display_id,
                x,
                y,
                width,
                height,
            } => {
                if *width <= 0.0 || *height <= 0.0 {
                    return Err(NativeError::invalid(
                        "Region width and height must be positive",
                    ));
                }
                let display = self.capture.display(display_id.as_deref())?;
                let requested = RectValue {
                    x: display.rect.x + x.round() as i32,
                    y: display.rect.y + y.round() as i32,
                    width: width.round() as i32,
                    height: height.round() as i32,
                };
                let capture = intersect(requested, display.rect).ok_or_else(|| {
                    NativeError::invalid("Capture region is outside the target display")
                })?;
                Ok(ResolvedTarget {
                    capture,
                    display: Some(display.info),
                    element_root: None,
                })
            }
            SnapshotTarget::App { app } => {
                let window = self.accessibility.find_application_window(app)?;
                self.resolve_window(window)
            }
            SnapshotTarget::Window { element_id } => {
                if !self.accessibility.is_window(*element_id)? {
                    return Err(NativeError::invalid("Target element is not a window"));
                }
                let element = self.accessibility.element(*element_id)?;
                let capture = self.accessibility.rect(*element_id)?;
                let display = self.capture.display_for_rect(capture).ok();
                Ok(ResolvedTarget {
                    capture,
                    display,
                    element_root: Some(element),
                })
            }
        }
    }

    fn resolve_window(&self, window: HWND) -> Result<ResolvedTarget, NativeError> {
        let capture = window_rect(window)?;
        let display = self.capture.display_for_rect(capture).ok();
        let element_root = Some(self.accessibility.element_from_window(window)?);
        Ok(ResolvedTarget {
            capture,
            display,
            element_root,
        })
    }
}

struct ResolvedTarget {
    capture: RectValue,
    display: Option<DisplayInfo>,
    element_root: Option<windows::Win32::UI::Accessibility::IUIAutomationElement>,
}

fn make_relative(element: &mut ElementInfo, capture: RectValue) {
    if let Some(bounds) = &mut element.bounds {
        bounds[0] -= capture.x as f64;
        bounds[1] -= capture.y as f64;
    }
}

fn cursor_relative(capture: RectValue) -> Option<PointValue> {
    unsafe {
        let mut cursor = POINT::default();
        if GetCursorPos(&mut cursor).is_err() {
            return None;
        }
        Some(PointValue {
            x: (cursor.x - capture.x) as f64,
            y: (cursor.y - capture.y) as f64,
        })
    }
}

fn intersect(a: RectValue, b: RectValue) -> Option<RectValue> {
    let left = a.x.max(b.x);
    let top = a.y.max(b.y);
    let right = a.right().min(b.right());
    let bottom = a.bottom().min(b.bottom());
    (right > left && bottom > top).then_some(RectValue {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}
