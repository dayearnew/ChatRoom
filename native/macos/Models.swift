import Foundation

struct NativeFailure: Error, LocalizedError {
    let code: String
    let message: String

    var errorDescription: String? { message }

    static func invalid(_ message: String) -> NativeFailure {
        NativeFailure(code: "invalid_request", message: message)
    }

    static func notFound(_ message: String) -> NativeFailure {
        NativeFailure(code: "not_found", message: message)
    }

    static func permission(_ message: String) -> NativeFailure {
        NativeFailure(code: "permission_required", message: message)
    }

    static func stale(_ message: String) -> NativeFailure {
        NativeFailure(code: "stale_snapshot", message: message)
    }

    static func unsupported(_ message: String) -> NativeFailure {
        NativeFailure(code: "unsupported", message: message)
    }

    static func internalError(_ message: String) -> NativeFailure {
        NativeFailure(code: "internal", message: message)
    }
}

enum PermissionName: String, Codable {
    case accessibility
    case screenRecording
}

enum PermissionState: String, Codable {
    case granted
    case denied
    case unknown
    case notRequired = "not-required"
}

struct PermissionStatus: Codable {
    let accessibility: PermissionState
    let screenRecording: PermissionState
}

struct DisplayInfo: Codable {
    let id: String
    let name: String
    let width: Double
    let height: Double
    let scale: Double
    let primary: Bool
}

struct PointValue: Codable {
    let x: Double
    let y: Double
}

struct RectValue: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct ScreenshotPayload: Codable {
    let mimeType: String
    let data: String
}

struct ElementInfo: Codable {
    let id: Int
    let role: String
    let name: String?
    let value: String?
    let enabled: Bool
    let focused: Bool
    let selected: Bool
    let sensitive: Bool
    let bounds: [Double]?
    let actions: [String]

    private enum CodingKeys: String, CodingKey {
        case id, role, name, value, enabled, focused, selected, sensitive, bounds, actions
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(name, forKey: .name)
        try container.encode(value, forKey: .value)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(focused, forKey: .focused)
        try container.encode(selected, forKey: .selected)
        try container.encode(sensitive, forKey: .sensitive)
        try container.encode(bounds, forKey: .bounds)
        try container.encode(actions, forKey: .actions)
    }
}

struct StatusPayload: Codable {
    let platform: String
    let helper: String
    let permissions: PermissionStatus
    let displays: [DisplayInfo]
}

enum SnapshotTargetType: String, Codable {
    case desktop
    case display
    case app
    case window
    case region
}

struct SnapshotTarget: Codable {
    let type: SnapshotTargetType
    let displayId: String?
    let app: String?
    let elementId: Int?
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
}

struct SnapshotRequest: Codable {
    let revision: Int?
    let target: SnapshotTarget?
    let includeScreenshot: Bool?
    let includeElements: Bool?
}

struct SnapshotPayload: Codable {
    let snapshotId: String
    let revision: Int
    let display: DisplayInfo?
    let activeApp: String?
    let activeWindow: String?
    let cursor: PointValue?
    let elements: [ElementInfo]
    let screenshot: ScreenshotPayload?

    private enum CodingKeys: String, CodingKey {
        case snapshotId, revision, display, activeApp, activeWindow, cursor, elements, screenshot
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(snapshotId, forKey: .snapshotId)
        try container.encode(revision, forKey: .revision)
        try container.encode(display, forKey: .display)
        try container.encode(activeApp, forKey: .activeApp)
        try container.encode(activeWindow, forKey: .activeWindow)
        try container.encode(cursor, forKey: .cursor)
        try container.encode(elements, forKey: .elements)
        try container.encodeIfPresent(screenshot, forKey: .screenshot)
    }
}

enum ComputerActionType: String, Codable {
    case move
    case click
    case doubleClick = "double_click"
    case rightClick = "right_click"
    case drag
    case scroll
    case keypress
    case typeText = "type_text"
    case invoke
    case setValue = "set_value"
    case selectText = "select_text"
    case activateApp = "activate_app"
    case activateWindow = "activate_window"
    case moveWindow = "move_window"
    case resizeWindow = "resize_window"
    case wait
}

struct ComputerAction: Codable {
    let type: ComputerActionType
    let x: Double?
    let y: Double?
    let elementId: Int?
    let from: PointValue?
    let to: PointValue?
    let durationMs: Int?
    let deltaX: Double?
    let deltaY: Double?
    let keys: [String]?
    let text: String?
    let value: String?
    let start: Int?
    let length: Int?
    let app: String?
    let width: Double?
    let height: Double?
    let ms: Int?

    var referencesElement: Bool { elementId != nil }
    var estimatedDurationMs: Int {
        switch type {
        case .wait: return max(0, ms ?? 0)
        case .drag: return max(0, durationMs ?? 0)
        default: return 0
        }
    }
}

struct ActionRequest: Codable {
    let snapshotId: String?
    let revision: Int?
    let actions: [ComputerAction]?
    let observeAfter: Bool?
}

enum ExecutionMode: String, Codable, Hashable {
    case semantic
    case background
    case foreground
    case mixed
}

struct ActionExecution {
    let mode: ExecutionMode
    let focusChanged: Bool
}

struct ActionPayload: Codable {
    let success: Bool
    let revision: Int
    let snapshot: SnapshotPayload?
    let executionMode: ExecutionMode
    let focusChanged: Bool
}

struct PermissionRequest: Codable {
    let permission: PermissionName
}
