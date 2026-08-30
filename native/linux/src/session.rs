use std::collections::HashSet;

use uuid::Uuid;

use crate::accessibility::Accessibility;
use crate::input::Input;
use crate::models::{
    ActionPayload, ActionRequest, DisplayInfo, ElementInfo, ExecutionMode, NativeError,
    PermissionStatus, PointValue, RectValue, SnapshotPayload, SnapshotRequest, SnapshotTarget,
    StatusPayload,
};
use crate::x11::{intersect, X11Controller};

pub struct ComputerSession {
    accessibility: Accessibility,
    x11: X11Controller,
    input: Input,
    current_snapshot_id: Option<String>,
    current_capture: Option<RectValue>,
}

impl ComputerSession {
    pub fn new() -> Result<Self, NativeError> {
        let x11 = X11Controller::new()?;
        Ok(Self {
            accessibility: Accessibility::new(),
            x11,
            input: Input,
            current_snapshot_id: None,
            current_capture: None,
        })
    }

    pub fn status(&self) -> StatusPayload {
        StatusPayload {
            platform: "linux",
            helper: "running",
            permissions: PermissionStatus {
                accessibility: "not-required",
                screen_recording: "not-required",
            },
            displays: self.x11.displays().unwrap_or_default(),
        }
    }

    pub fn snapshot(&mut self, request: SnapshotRequest) -> Result<SnapshotPayload, NativeError> {
        let include_screenshot = request.include_screenshot.unwrap_or(true);
        let include_elements = request.include_elements.unwrap_or(true);
        self.current_snapshot_id = None;

        let resolved = self.resolve_target(request.target.as_ref())?;
        let (active_app, active_window) = self.x11.active_context();
        let app_hint = resolved.app_hint.as_deref().or(active_app.as_deref());
        let mut elements = if include_elements {
            self.accessibility
                .collect(app_hint, Some(&resolved.allowed_pids))?
        } else {
            self.accessibility.reset_elements();
            Vec::new()
        };
        for element in &mut elements {
            make_relative(element, resolved.capture);
        }

        let cursor = self.x11.cursor().map(|cursor| PointValue {
            x: cursor.x - resolved.capture.x as f64,
            y: cursor.y - resolved.capture.y as f64,
        });
        let screenshot = if include_screenshot {
            Some(self.x11.screenshot(resolved.capture)?)
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

        let capture = request.snapshot_id.as_ref().and(self.current_capture);
        self.current_snapshot_id = None;
        let mut modes = HashSet::new();
        let mut focus_changed = false;
        for action in &request.actions {
            let execution = self
                .input
                .perform(&self.x11, &self.accessibility, action, capture)?;
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
                let capture = self.x11.virtual_screen();
                let display = self.x11.display(None).ok().map(|value| value.info);
                Ok(ResolvedTarget {
                    capture,
                    display,
                    app_hint: None,
                    allowed_pids: self.x11.current_window_pids()?,
                })
            }
            SnapshotTarget::Display { display_id } => {
                let display = self.x11.display(display_id.as_deref())?;
                Ok(ResolvedTarget {
                    capture: display.rect,
                    display: Some(display.info),
                    app_hint: None,
                    allowed_pids: self.x11.current_window_pids()?,
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
                let display = self.x11.display(display_id.as_deref())?;
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
                    app_hint: None,
                    allowed_pids: self.x11.current_window_pids()?,
                })
            }
            SnapshotTarget::App { app } => {
                let window = self.x11.find_window(app)?;
                let display = self.x11.display_for_rect(window.rect).ok();
                Ok(ResolvedTarget {
                    capture: window.rect,
                    display,
                    app_hint: Some(app.clone()),
                    allowed_pids: window
                        .pid
                        .map(|pid| self.x11.process_tree_pids(pid))
                        .unwrap_or_default(),
                })
            }
            SnapshotTarget::Window { element_id } => {
                if !self.accessibility.is_window(*element_id)? {
                    return Err(NativeError::invalid("Target element is not a window"));
                }
                let capture = self.accessibility.rect(*element_id)?;
                let display = self.x11.display_for_rect(capture).ok();
                let allowed_pids = self
                    .x11
                    .window_for_rect(capture)?
                    .and_then(|window| window.pid)
                    .map(|pid| self.x11.process_tree_pids(pid))
                    .unwrap_or_default();
                Ok(ResolvedTarget {
                    capture,
                    display,
                    app_hint: None,
                    allowed_pids,
                })
            }
        }
    }
}

struct ResolvedTarget {
    capture: RectValue,
    display: Option<DisplayInfo>,
    app_hint: Option<String>,
    allowed_pids: HashSet<u32>,
}

fn make_relative(element: &mut ElementInfo, capture: RectValue) {
    if let Some(bounds) = &mut element.bounds {
        bounds[0] -= capture.x as f64;
        bounds[1] -= capture.y as f64;
    }
}
