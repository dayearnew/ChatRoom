import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit

final class ComputerSession {
    private let accessibility = AccessibilityController()
    private let capture = CaptureController()
    private lazy var input = InputController(accessibility: accessibility)
    private var currentSnapshotId: String?
    private var currentDisplayBounds = CGRect.zero

    func status() -> StatusPayload {
        StatusPayload(
            platform: "macos",
            helper: "running",
            permissions: permissionStatus(),
            displays: capture.displays()
        )
    }

    func requestPermission(_ permission: PermissionName) {
        switch permission {
        case .accessibility:
            if !AXIsProcessTrusted() {
                let options = [
                    kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
                ] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
            }
        case .screenRecording:
            if !CGPreflightScreenCaptureAccess() {
                _ = CGRequestScreenCaptureAccess()
            }
        }
    }

    func snapshot(_ request: SnapshotRequest) throws -> SnapshotPayload {
        let includeScreenshot = request.includeScreenshot ?? true
        let includeElements = request.includeElements ?? true
        if includeElements && !AXIsProcessTrusted() {
            throw NativeFailure.permission(
                "Accessibility permission is required. Grant it from ChatRoom settings."
            )
        }
        if includeScreenshot && !CGPreflightScreenCaptureAccess() {
            throw NativeFailure.permission(
                "Screen Recording permission is required. Grant it from ChatRoom settings."
            )
        }

        var context = accessibility.focusedContext()
        var requestedDisplayId = String(CGMainDisplayID())
        var captureRegion: RectValue?
        var filteredWindow: SCWindow?
        var filteredApp: NSRunningApplication?
        var filteredAppBounds: CGRect?
        let target = request.target

        switch target?.type ?? .desktop {
        case .desktop:
            break

        case .display:
            if let displayId = target?.displayId { requestedDisplayId = displayId }

        case .region:
            if let displayId = target?.displayId { requestedDisplayId = displayId }
            guard let x = target?.x, let y = target?.y,
                  let width = target?.width, let height = target?.height,
                  width > 0, height > 0
            else {
                throw NativeFailure.invalid("Region target requires positive x, y, width and height")
            }
            captureRegion = RectValue(x: x, y: y, width: width, height: height)

        case .app:
            guard let query = target?.app,
                  let app = accessibility.runningApplication(matching: query)
            else {
                throw NativeFailure.notFound("Target application is not running")
            }
            context = accessibility.appContext(app)
            filteredApp = app
            filteredAppBounds = accessibility.appBounds(app)
            if let bounds = filteredAppBounds {
                requestedDisplayId = String(
                    capture.displayContaining(CGPoint(x: bounds.midX, y: bounds.midY))
                )
            }

        case .window:
            guard let elementId = target?.elementId,
                  let window = accessibility.element(id: elementId),
                  accessibility.string(window, kAXRoleAttribute as CFString) == kAXWindowRole
            else {
                throw NativeFailure.stale(
                    "Target window element is unavailable; take a fresh snapshot first"
                )
            }
            var pid: pid_t = 0
            _ = AXUIElementGetPid(window, &pid)
            let app = pid > 0 ? NSRunningApplication(processIdentifier: pid) : nil
            context = (
                window,
                app?.localizedName,
                accessibility.string(window, kAXTitleAttribute as CFString)
            )
            if includeScreenshot {
                filteredWindow = try capture.screenCaptureWindow(
                    for: window,
                    accessibility: accessibility
                )
            }
            if let bounds = accessibility.rect(window) {
                requestedDisplayId = String(
                    capture.displayContaining(CGPoint(x: bounds.midX, y: bounds.midY))
                )
            }
        }

        let displayItems = capture.displays()
        guard let selectedDisplay = displayItems.first(where: { $0.id == requestedDisplayId })
            ?? displayItems.first,
              let nativeDisplay = UInt32(selectedDisplay.id)
        else {
            throw NativeFailure.notFound("No active display is available")
        }
        requestedDisplayId = selectedDisplay.id
        currentDisplayBounds = CGDisplayBounds(nativeDisplay)

        let snapshotId = UUID().uuidString
        currentSnapshotId = snapshotId
        accessibility.resetElements()

        var elements = includeElements && context.0 != nil
            ? accessibility.collectElements(context.0!)
            : []
        elements = elements.map { makeDisplayRelative($0, displayBounds: currentDisplayBounds) }

        let cursor: PointValue?
        if let point = CGEvent(source: nil)?.location,
           currentDisplayBounds.contains(point) {
            cursor = PointValue(
                x: Double(point.x - currentDisplayBounds.origin.x),
                y: Double(point.y - currentDisplayBounds.origin.y)
            )
        } else {
            cursor = nil
        }

        let screenshot: ScreenshotPayload?
        if !includeScreenshot {
            screenshot = nil
        } else if let filteredWindow {
            screenshot = try capture.captureWindow(filteredWindow)
        } else if let filteredApp {
            guard let filteredAppBounds else {
                throw NativeFailure.notFound("Target application window bounds are unavailable")
            }
            screenshot = try capture.captureApplication(
                filteredApp,
                bounds: filteredAppBounds,
                displayId: nativeDisplay
            )
        } else {
            screenshot = try capture.captureDisplay(
                displayId: requestedDisplayId,
                region: captureRegion
            )
        }

        return SnapshotPayload(
            snapshotId: snapshotId,
            revision: request.revision ?? 0,
            display: selectedDisplay,
            activeApp: context.1,
            activeWindow: context.2,
            cursor: cursor,
            elements: elements,
            screenshot: screenshot
        )
    }

    func action(_ request: ActionRequest) throws -> ActionPayload {
        guard AXIsProcessTrusted() else {
            throw NativeFailure.permission(
                "Accessibility permission is required. Grant it from ChatRoom settings."
            )
        }
        let actions = request.actions ?? []
        guard !actions.isEmpty, actions.count <= 50 else {
            throw NativeFailure.invalid("Computer action requires between 1 and 50 actions")
        }
        let durationMs = actions.reduce(0) { $0 + $1.estimatedDurationMs }
        guard durationMs <= 30_000 else {
            throw NativeFailure.invalid("Computer action batch exceeds the 30 second execution budget")
        }
        if request.observeAfter ?? true,
           !CGPreflightScreenCaptureAccess() {
            throw NativeFailure.permission(
                "Screen Recording permission is required to observe after actions."
            )
        }

        let referencesElements = actions.contains(where: \.referencesElement)
        if referencesElements && request.snapshotId == nil {
            throw NativeFailure.stale(
                "Actions using elementId require the latest snapshotId"
            )
        }
        if let supplied = request.snapshotId, supplied != currentSnapshotId {
            throw NativeFailure.stale(
                "Computer snapshot is stale; take a new snapshot before acting"
            )
        }
        if referencesElements && currentSnapshotId == nil {
            throw NativeFailure.stale(
                "Computer snapshot is stale; take a new snapshot before acting"
            )
        }
        if currentDisplayBounds.isNull || currentDisplayBounds.isEmpty {
            currentDisplayBounds = CGDisplayBounds(CGMainDisplayID())
        }

        currentSnapshotId = nil
        var modes = Set<ExecutionMode>()
        var focusChanged = false
        for action in actions {
            let execution = try input.perform(action, displayBounds: currentDisplayBounds)
            modes.insert(execution.mode)
            focusChanged = focusChanged || execution.focusChanged
        }

        let revision = request.revision ?? 0
        let observed: SnapshotPayload?
        if request.observeAfter ?? true {
            observed = try snapshot(
                SnapshotRequest(
                    revision: revision,
                    target: nil,
                    includeScreenshot: true,
                    includeElements: true
                )
            )
        } else {
            accessibility.resetElements()
            observed = nil
        }

        let executionMode: ExecutionMode
        if modes.count > 1 {
            executionMode = .mixed
        } else {
            executionMode = modes.first ?? .background
        }
        return ActionPayload(
            success: true,
            revision: revision,
            snapshot: observed,
            executionMode: executionMode,
            focusChanged: focusChanged
        )
    }

    private func permissionStatus() -> PermissionStatus {
        PermissionStatus(
            accessibility: AXIsProcessTrusted() ? .granted : .denied,
            screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .denied
        )
    }

    private func makeDisplayRelative(
        _ element: ElementInfo,
        displayBounds: CGRect
    ) -> ElementInfo {
        guard let bounds = element.bounds, bounds.count == 4 else { return element }
        return ElementInfo(
            id: element.id,
            role: element.role,
            name: element.name,
            value: element.value,
            enabled: element.enabled,
            focused: element.focused,
            selected: element.selected,
            sensitive: element.sensitive,
            bounds: [
                bounds[0] - Double(displayBounds.origin.x),
                bounds[1] - Double(displayBounds.origin.y),
                bounds[2],
                bounds[3],
            ],
            actions: element.actions
        )
    }
}
