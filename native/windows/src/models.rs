use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub struct NativeError {
    pub code: &'static str,
    pub message: String,
}

impl NativeError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_request",
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "not_found",
            message: message.into(),
        }
    }

    pub fn stale(message: impl Into<String>) -> Self {
        Self {
            code: "stale_snapshot",
            message: message.into(),
        }
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "unsupported",
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "internal",
            message: message.into(),
        }
    }
}

impl From<windows::core::Error> for NativeError {
    fn from(value: windows::core::Error) -> Self {
        Self::internal(value.to_string())
    }
}

impl From<std::io::Error> for NativeError {
    fn from(value: std::io::Error) -> Self {
        Self::internal(value.to_string())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub accessibility: &'static str,
    pub screen_recording: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub primary: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct PointValue {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct RectValue {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl RectValue {
    pub fn right(self) -> i32 {
        self.x + self.width
    }
    pub fn bottom(self) -> i32 {
        self.y + self.height
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPayload {
    pub mime_type: &'static str,
    pub data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementInfo {
    pub id: i32,
    pub role: String,
    pub name: Option<String>,
    pub value: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub selected: bool,
    pub sensitive: bool,
    pub bounds: Option<[f64; 4]>,
    pub actions: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub platform: &'static str,
    pub helper: &'static str,
    pub permissions: PermissionStatus,
    pub displays: Vec<DisplayInfo>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SnapshotTarget {
    Desktop,
    Display {
        #[serde(rename = "displayId")]
        display_id: Option<String>,
    },
    App {
        app: String,
    },
    Window {
        #[serde(rename = "elementId")]
        element_id: i32,
    },
    Region {
        #[serde(rename = "displayId")]
        display_id: Option<String>,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRequest {
    pub revision: Option<i64>,
    pub target: Option<SnapshotTarget>,
    pub include_screenshot: Option<bool>,
    pub include_elements: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPayload {
    pub snapshot_id: String,
    pub revision: i64,
    pub display: Option<DisplayInfo>,
    pub active_app: Option<String>,
    pub active_window: Option<String>,
    pub cursor: Option<PointValue>,
    pub elements: Vec<ElementInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<ScreenshotPayload>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ComputerAction {
    Move {
        x: f64,
        y: f64,
    },
    Click {
        x: Option<f64>,
        y: Option<f64>,
        #[serde(rename = "elementId")]
        element_id: Option<i32>,
    },
    DoubleClick {
        x: Option<f64>,
        y: Option<f64>,
        #[serde(rename = "elementId")]
        element_id: Option<i32>,
    },
    RightClick {
        x: Option<f64>,
        y: Option<f64>,
        #[serde(rename = "elementId")]
        element_id: Option<i32>,
    },
    Drag {
        from: PointValue,
        to: PointValue,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
    },
    Scroll {
        #[serde(rename = "deltaX")]
        delta_x: Option<f64>,
        #[serde(rename = "deltaY")]
        delta_y: f64,
        #[serde(rename = "elementId")]
        element_id: Option<i32>,
    },
    Keypress {
        keys: Vec<String>,
    },
    TypeText {
        text: String,
        #[serde(rename = "elementId")]
        element_id: Option<i32>,
    },
    Invoke {
        #[serde(rename = "elementId")]
        element_id: i32,
    },
    SetValue {
        #[serde(rename = "elementId")]
        element_id: i32,
        value: String,
    },
    SelectText {
        #[serde(rename = "elementId")]
        element_id: i32,
        start: i32,
        length: i32,
    },
    ActivateApp {
        app: String,
    },
    ActivateWindow {
        #[serde(rename = "elementId")]
        element_id: i32,
    },
    MoveWindow {
        #[serde(rename = "elementId")]
        element_id: i32,
        x: f64,
        y: f64,
    },
    ResizeWindow {
        #[serde(rename = "elementId")]
        element_id: i32,
        width: f64,
        height: f64,
    },
    Wait {
        ms: u64,
    },
}

impl ComputerAction {
    pub fn element_id(&self) -> Option<i32> {
        match self {
            Self::Click { element_id, .. }
            | Self::DoubleClick { element_id, .. }
            | Self::RightClick { element_id, .. }
            | Self::Scroll { element_id, .. }
            | Self::TypeText { element_id, .. } => *element_id,
            Self::Invoke { element_id }
            | Self::SetValue { element_id, .. }
            | Self::SelectText { element_id, .. }
            | Self::ActivateWindow { element_id }
            | Self::MoveWindow { element_id, .. }
            | Self::ResizeWindow { element_id, .. } => Some(*element_id),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub snapshot_id: Option<String>,
    pub revision: Option<i64>,
    pub actions: Vec<ComputerAction>,
    pub observe_after: Option<bool>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionMode {
    Semantic,
    Background,
    Foreground,
    Mixed,
}

#[derive(Clone, Copy, Debug)]
pub struct ActionExecution {
    pub mode: ExecutionMode,
    pub focus_changed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPayload {
    pub success: bool,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<SnapshotPayload>,
    pub execution_mode: ExecutionMode,
    pub focus_changed: bool,
}
