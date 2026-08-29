import Foundation
import AppKit
import ApplicationServices

final class InputController {
    private let accessibility: AccessibilityController

    init(accessibility: AccessibilityController) {
        self.accessibility = accessibility
    }

    func perform(_ action: ComputerAction, displayBounds: CGRect) throws -> ActionExecution {
        if let semantic = try performSemantic(action) { return semantic }

        switch action.type {
        case .move:
            let point = try targetPoint(action, displayBounds: displayBounds)
            try postMouse(.mouseMoved, point: point)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .click, .rightClick:
            let point = try targetPoint(action, displayBounds: displayBounds)
            let right = action.type == .rightClick
            let button: CGMouseButton = right ? .right : .left
            let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
            let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
            try postMouse(down, point: point, button: button)
            try postMouse(up, point: point, button: button)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .doubleClick:
            let point = try targetPoint(action, displayBounds: displayBounds)
            try postMouse(.leftMouseDown, point: point, clicks: 1)
            try postMouse(.leftMouseUp, point: point, clicks: 1)
            try postMouse(.leftMouseDown, point: point, clicks: 2)
            try postMouse(.leftMouseUp, point: point, clicks: 2)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .drag:
            guard let from = action.from, let to = action.to else {
                throw NativeFailure.invalid("Drag requires from and to coordinates")
            }
            let start = absolutePoint(from, displayBounds: displayBounds)
            let end = absolutePoint(to, displayBounds: displayBounds)
            let duration = max(0, min(10_000, action.durationMs ?? 0))
            let steps = duration == 0 ? 1 : max(1, min(60, duration / 16))
            try postMouse(.leftMouseDown, point: start)
            for step in 1...steps {
                let progress = CGFloat(step) / CGFloat(steps)
                let point = CGPoint(
                    x: start.x + (end.x - start.x) * progress,
                    y: start.y + (end.y - start.y) * progress
                )
                try postMouse(.leftMouseDragged, point: point)
                if duration > 0 {
                    Thread.sleep(forTimeInterval: Double(duration) / Double(steps) / 1000.0)
                }
            }
            try postMouse(.leftMouseUp, point: end)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .scroll:
            guard let deltaY = action.deltaY else {
                throw NativeFailure.invalid("Scroll requires deltaY")
            }
            guard let event = CGEvent(
                scrollWheelEvent2Source: nil,
                units: .pixel,
                wheelCount: 2,
                wheel1: Int32(deltaY),
                wheel2: Int32(action.deltaX ?? 0),
                wheel3: 0
            ) else {
                throw NativeFailure.internalError("Unable to create scroll event")
            }
            if action.elementId != nil {
                event.location = try targetPoint(action, displayBounds: displayBounds)
            }
            event.post(tap: .cghidEventTap)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .keypress:
            let keys = action.keys ?? []
            guard !keys.isEmpty else {
                throw NativeFailure.invalid("Keypress requires at least one key")
            }
            var flags: CGEventFlags = []
            for key in keys {
                switch key.uppercased() {
                case "CMD", "COMMAND", "META": flags.insert(.maskCommand)
                case "CTRL", "CONTROL": flags.insert(.maskControl)
                case "ALT", "OPTION": flags.insert(.maskAlternate)
                case "SHIFT": flags.insert(.maskShift)
                default: break
                }
            }
            guard let code = keys.reversed().compactMap(keyCode).first,
                  let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
            else {
                throw NativeFailure.invalid("Keypress contains no supported key")
            }
            down.flags = flags
            up.flags = flags
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            return ActionExecution(mode: .foreground, focusChanged: false)

        case .typeText:
            if let elementId = action.elementId,
               let element = accessibility.element(id: elementId) {
                let result = AXUIElementSetAttributeValue(
                    element,
                    kAXFocusedAttribute as CFString,
                    kCFBooleanTrue
                )
                if result != .success {
                    throw NativeFailure.invalid("Target element cannot receive keyboard focus")
                }
            }
            try typeText(action.text ?? "")
            return ActionExecution(mode: .foreground, focusChanged: action.elementId != nil)

        case .activateApp:
            guard let query = action.app, !query.isEmpty else {
                throw NativeFailure.invalid("activate_app requires an application")
            }
            let app = try accessibility.resolveApplication(query)
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            _ = AXUIElementSetAttributeValue(
                axApp,
                kAXFrontmostAttribute as CFString,
                kCFBooleanTrue
            )
            _ = app.activate()
            guard accessibility.waitUntilApplicationIsFocused(app) else {
                throw NativeFailure.notFound("Application could not be activated")
            }
            return ActionExecution(mode: .foreground, focusChanged: true)

        case .activateWindow:
            let element = try requiredElement(action)
            guard AXUIElementPerformAction(element, kAXRaiseAction as CFString) == .success else {
                throw NativeFailure.invalid("Target window cannot be raised")
            }
            return ActionExecution(mode: .semantic, focusChanged: true)

        case .moveWindow:
            let element = try requiredElement(action)
            guard let x = action.x, let y = action.y else {
                throw NativeFailure.invalid("move_window requires x and y")
            }
            var point = CGPoint(
                x: x + Double(displayBounds.origin.x),
                y: y + Double(displayBounds.origin.y)
            )
            guard let value = AXValueCreate(.cgPoint, &point),
                  AXUIElementSetAttributeValue(
                    element,
                    kAXPositionAttribute as CFString,
                    value
                  ) == .success
            else {
                throw NativeFailure.invalid("Target window cannot be moved")
            }
            return ActionExecution(mode: .semantic, focusChanged: false)

        case .resizeWindow:
            let element = try requiredElement(action)
            guard let width = action.width, let height = action.height,
                  width > 0, height > 0
            else {
                throw NativeFailure.invalid("resize_window requires positive width and height")
            }
            var size = CGSize(width: width, height: height)
            guard let value = AXValueCreate(.cgSize, &size),
                  AXUIElementSetAttributeValue(
                    element,
                    kAXSizeAttribute as CFString,
                    value
                  ) == .success
            else {
                throw NativeFailure.invalid("Target window cannot be resized")
            }
            return ActionExecution(mode: .semantic, focusChanged: false)

        case .wait:
            let milliseconds = action.ms ?? 0
            guard (0...30_000).contains(milliseconds) else {
                throw NativeFailure.invalid("wait must be between 0 and 30000 ms")
            }
            Thread.sleep(forTimeInterval: Double(milliseconds) / 1000.0)
            return ActionExecution(mode: .background, focusChanged: false)

        case .invoke, .setValue, .selectText:
            throw NativeFailure.invalid("Semantic action is not supported by the target element")
        }
    }

    private func performSemantic(_ action: ComputerAction) throws -> ActionExecution? {
        guard let elementId = action.elementId,
              let element = accessibility.element(id: elementId)
        else { return nil }

        switch action.type {
        case .click:
            if AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
                return ActionExecution(mode: .semantic, focusChanged: false)
            }

        case .invoke:
            if AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
                return ActionExecution(mode: .semantic, focusChanged: false)
            }
            _ = AXUIElementSetAttributeValue(
                element,
                kAXFocusedAttribute as CFString,
                kCFBooleanTrue
            )
            if AXUIElementPerformAction(element, kAXConfirmAction as CFString) == .success {
                return ActionExecution(mode: .semantic, focusChanged: true)
            }

        case .setValue, .typeText:
            let text = action.type == .setValue ? action.value : action.text
            if let text,
               AXUIElementSetAttributeValue(
                element,
                kAXValueAttribute as CFString,
                text as CFTypeRef
               ) == .success {
                return ActionExecution(mode: .semantic, focusChanged: false)
            }

        case .selectText:
            guard let start = action.start, let length = action.length,
                  start >= 0, length >= 0
            else {
                throw NativeFailure.invalid("select_text requires a valid range")
            }
            var range = CFRange(location: start, length: length)
            if let value = AXValueCreate(.cfRange, &range),
               AXUIElementSetAttributeValue(
                element,
                kAXSelectedTextRangeAttribute as CFString,
                value
               ) == .success {
                return ActionExecution(mode: .semantic, focusChanged: false)
            }

        default:
            break
        }
        return nil
    }

    private func requiredElement(_ action: ComputerAction) throws -> AXUIElement {
        guard let elementId = action.elementId,
              let element = accessibility.element(id: elementId)
        else {
            throw NativeFailure.stale("Target element is unavailable; take a fresh snapshot")
        }
        return element
    }

    private func targetPoint(_ action: ComputerAction, displayBounds: CGRect) throws -> CGPoint {
        if let elementId = action.elementId,
           let element = accessibility.element(id: elementId),
           let rect = accessibility.rect(element) {
            return CGPoint(x: rect.midX, y: rect.midY)
        }
        guard let x = action.x, let y = action.y else {
            throw NativeFailure.invalid("Action requires coordinates or a valid elementId")
        }
        return CGPoint(
            x: x + Double(displayBounds.origin.x),
            y: y + Double(displayBounds.origin.y)
        )
    }

    private func absolutePoint(_ point: PointValue, displayBounds: CGRect) -> CGPoint {
        CGPoint(
            x: point.x + Double(displayBounds.origin.x),
            y: point.y + Double(displayBounds.origin.y)
        )
    }

    private func postMouse(
        _ type: CGEventType,
        point: CGPoint,
        button: CGMouseButton = .left,
        clicks: Int64 = 1
    ) throws {
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button
        ) else {
            throw NativeFailure.internalError("Unable to create mouse event")
        }
        event.setIntegerValueField(.mouseEventClickState, value: clicks)
        event.post(tap: .cghidEventTap)
    }

    private func typeText(_ text: String) throws {
        var characters = Array(text.utf16)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else {
            throw NativeFailure.internalError("Unable to create keyboard event")
        }
        down.keyboardSetUnicodeString(
            stringLength: characters.count,
            unicodeString: &characters
        )
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func keyCode(_ raw: String) -> CGKeyCode? {
        let map: [String: CGKeyCode] = [
            "ENTER": 36, "RETURN": 36, "TAB": 48, "SPACE": 49, "ESC": 53,
            "ESCAPE": 53, "BACKSPACE": 51, "DELETE": 117, "FORWARD_DELETE": 117,
            "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121,
            "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
            "0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23,
            "6": 22, "7": 26, "8": 28, "9": 25,
            "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6,
            "X": 7, "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13,
            "E": 14, "R": 15, "Y": 16, "T": 17, "O": 31, "U": 32,
            "I": 34, "P": 35, "L": 37, "J": 38, "K": 40, "N": 45,
            "M": 46, "F1": 122, "F2": 120, "F3": 99, "F4": 118,
            "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101,
            "F10": 109, "F11": 103, "F12": 111, "MINUS": 27,
            "EQUAL": 24, "LEFT_BRACKET": 33, "RIGHT_BRACKET": 30,
            "SEMICOLON": 41, "QUOTE": 39, "COMMA": 43, "PERIOD": 47,
            "SLASH": 44, "BACKSLASH": 42, "GRAVE": 50,
        ]
        return map[raw.uppercased()]
    }
}
