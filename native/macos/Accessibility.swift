import Foundation
import AppKit
import ApplicationServices

final class AccessibilityController {
    private var elementMap: [Int: AXUIElement] = [:]
    private var nextElementId = 1

    func resetElements() {
        elementMap.removeAll(keepingCapacity: true)
        nextElementId = 1
    }

    func element(id: Int) -> AXUIElement? {
        elementMap[id]
    }

    func value(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        return value
    }

    func string(_ element: AXUIElement, _ attribute: CFString) -> String? {
        value(element, attribute) as? String
    }

    func bool(_ element: AXUIElement, _ attribute: CFString) -> Bool {
        (value(element, attribute) as? Bool) ?? false
    }

    func rect(_ element: AXUIElement) -> CGRect? {
        guard
            let positionValue = value(element, kAXPositionAttribute as CFString),
            let sizeValue = value(element, kAXSizeAttribute as CFString),
            CFGetTypeID(positionValue) == AXValueGetTypeID(),
            CFGetTypeID(sizeValue) == AXValueGetTypeID()
        else { return nil }

        var point = CGPoint.zero
        var size = CGSize.zero
        let position = unsafeBitCast(positionValue, to: AXValue.self)
        let dimensions = unsafeBitCast(sizeValue, to: AXValue.self)
        guard AXValueGetValue(position, .cgPoint, &point) else { return nil }
        guard AXValueGetValue(dimensions, .cgSize, &size) else { return nil }
        return CGRect(origin: point, size: size)
    }

    func runningApplication(matching query: String) -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first {
            $0.bundleIdentifier == query || $0.localizedName == query
        }
    }

    func appContext(_ app: NSRunningApplication) -> (AXUIElement, String?, String?) {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        if let window = elementAttribute(axApp, kAXFocusedWindowAttribute as CFString) {
            return (window, app.localizedName, string(window, kAXTitleAttribute as CFString))
        }
        return (axApp, app.localizedName, nil)
    }

    func appBounds(_ app: NSRunningApplication) -> CGRect? {
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        guard let windows = value(axApp, kAXWindowsAttribute as CFString) as? [AXUIElement] else {
            return nil
        }
        return windows.compactMap(rect).reduce(nil as CGRect?) { bounds, rect in
            bounds?.union(rect) ?? rect
        }
    }

    func focusedContext() -> (AXUIElement?, String?, String?) {
        let system = AXUIElementCreateSystemWide()
        if let axApp = elementAttribute(system, kAXFocusedApplicationAttribute as CFString) {
            var pid: pid_t = 0
            if AXUIElementGetPid(axApp, &pid) == .success {
                let app = NSRunningApplication(processIdentifier: pid)
                let root = elementAttribute(axApp, kAXFocusedWindowAttribute as CFString) ?? axApp
                return (root, app?.localizedName, string(root, kAXTitleAttribute as CFString))
            }
        }

        guard let app = NSWorkspace.shared.frontmostApplication else {
            return (nil, nil, nil)
        }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        let root = elementAttribute(axApp, kAXFocusedWindowAttribute as CFString) ?? axApp
        return (root, app.localizedName, string(root, kAXTitleAttribute as CFString))
    }

    func collectElements(_ root: AXUIElement) -> [ElementInfo] {
        var output: [ElementInfo] = []
        var queue: [AXUIElement] = [root]
        var index = 0
        var visited = Set<CFHashCode>()

        while index < queue.count && output.count < 500 && visited.count < 2_000 {
            let element = queue[index]
            index += 1
            let identity = CFHash(element)
            guard visited.insert(identity).inserted else { continue }

            let role = string(element, kAXRoleAttribute as CFString)
            let name = string(element, kAXTitleAttribute as CFString)
                ?? string(element, kAXDescriptionAttribute as CFString)
            let actions = availableActions(element)
            if !actions.isEmpty || name != nil || role == kAXWindowRole {
                output.append(elementInfo(element, name: name, role: role, actions: actions))
            }

            if let children = value(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
                queue.append(contentsOf: children.prefix(100))
            }
        }
        return output
    }

    func resolveApplication(_ query: String) throws -> NSRunningApplication {
        if let running = runningApplication(matching: query) { return running }
        guard query.contains("."),
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: query)
        else {
            throw NativeFailure.notFound("Application not found")
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        let semaphore = DispatchSemaphore(value: 0)
        var launched: NSRunningApplication?
        var launchError: Error?
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            launched = app
            launchError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let launchError { throw launchError }
        guard let launched else {
            throw NativeFailure.notFound("Application could not be launched")
        }
        return launched
    }

    func waitUntilApplicationIsFocused(
        _ app: NSRunningApplication,
        timeout: TimeInterval = 2.0
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if app.isActive || systemFocusedApplicationPID() == app.processIdentifier {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        } while Date() < deadline
        return app.isActive || systemFocusedApplicationPID() == app.processIdentifier
    }

    private func elementAttribute(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
        guard let raw = value(element, attribute),
              CFGetTypeID(raw) == AXUIElementGetTypeID()
        else { return nil }
        return unsafeBitCast(raw, to: AXUIElement.self)
    }

    private func systemFocusedApplicationPID() -> pid_t? {
        let system = AXUIElementCreateSystemWide()
        guard let appElement = elementAttribute(system, kAXFocusedApplicationAttribute as CFString) else {
            return nil
        }
        var pid: pid_t = 0
        return AXUIElementGetPid(appElement, &pid) == .success ? pid : nil
    }

    private func elementInfo(
        _ element: AXUIElement,
        name: String?,
        role: String?,
        actions: [String]
    ) -> ElementInfo {
        let id = nextElementId
        nextElementId += 1
        elementMap[id] = element

        let sensitive = isSensitive(element)
        let bounds = rect(element).map {
            [Double($0.minX), Double($0.minY), Double($0.width), Double($0.height)]
        }
        return ElementInfo(
            id: id,
            role: normalizedRole(role),
            name: name,
            value: sensitive ? nil : string(element, kAXValueAttribute as CFString),
            enabled: bool(element, kAXEnabledAttribute as CFString),
            focused: bool(element, kAXFocusedAttribute as CFString),
            selected: bool(element, kAXSelectedAttribute as CFString),
            sensitive: sensitive,
            bounds: bounds,
            actions: actions
        )
    }

    private func isSensitive(_ element: AXUIElement) -> Bool {
        let role = string(element, kAXRoleAttribute as CFString) ?? ""
        let subrole = string(element, kAXSubroleAttribute as CFString) ?? ""
        return role.localizedCaseInsensitiveContains("secure")
            || subrole.localizedCaseInsensitiveContains("secure")
    }

    private func normalizedRole(_ raw: String?) -> String {
        switch raw ?? "" {
        case kAXWindowRole: return "window"
        case kAXButtonRole: return "button"
        case kAXTextFieldRole, kAXTextAreaRole: return "textbox"
        case kAXStaticTextRole: return "text"
        case kAXCheckBoxRole: return "checkbox"
        case kAXRadioButtonRole: return "radio"
        case kAXMenuRole: return "menu"
        case kAXMenuItemRole: return "menuitem"
        case kAXListRole: return "list"
        case kAXTableRole: return "table"
        case "AXLink": return "link"
        case kAXSliderRole: return "slider"
        case kAXTabGroupRole: return "tab"
        default: return "other"
        }
    }

    private func availableActions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success,
              let values = names as? [String]
        else { return [] }
        return values.map { $0 == kAXPressAction ? "invoke" : $0 }
    }
}
