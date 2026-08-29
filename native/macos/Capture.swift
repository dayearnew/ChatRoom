import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit
import ImageIO
import UniformTypeIdentifiers

final class CaptureController {
    func screen(for displayId: CGDirectDisplayID) -> NSScreen? {
        NSScreen.screens.first { screen in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return false
            }
            return number.uint32Value == displayId
        }
    }

    func displays() -> [DisplayInfo] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success else { return [] }
        var ids = Array(repeating: CGDirectDisplayID(), count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else { return [] }

        return ids.prefix(Int(count)).enumerated().map { index, id in
            let bounds = CGDisplayBounds(id)
            let matchedScreen = screen(for: id)
            return DisplayInfo(
                id: String(id),
                name: matchedScreen?.localizedName
                    ?? (index == 0 ? "Primary Display" : "Display \(index + 1)"),
                width: Double(bounds.width),
                height: Double(bounds.height),
                scale: Double(matchedScreen?.backingScaleFactor ?? 1),
                primary: CGDisplayIsMain(id) != 0
            )
        }
    }

    func displayContaining(_ point: CGPoint) -> CGDirectDisplayID {
        var count: UInt32 = 0
        var ids = Array(repeating: CGDirectDisplayID(), count: 16)
        if CGGetDisplaysWithPoint(point, UInt32(ids.count), &ids, &count) == .success,
           count > 0 {
            return ids[0]
        }
        return CGMainDisplayID()
    }

    func captureDisplay(displayId: String?, region: RectValue?) throws -> ScreenshotPayload {
        let requestedDisplay = displayId.flatMap(UInt32.init) ?? CGMainDisplayID()
        let content = try shareableContent()
        guard let display = content.displays.first(where: { $0.displayID == requestedDisplay }) else {
            throw NativeFailure.notFound("Target display is unavailable")
        }

        let displayBounds = CGDisplayBounds(requestedDisplay)
        var sourceRect = CGRect(
            x: 0,
            y: 0,
            width: displayBounds.width,
            height: displayBounds.height
        )
        if let region {
            let requested = CGRect(
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height
            )
            sourceRect = requested.intersection(sourceRect)
            guard !sourceRect.isNull && !sourceRect.isEmpty else {
                throw NativeFailure.invalid("Capture region is outside the target display")
            }
        }

        let configuration = SCStreamConfiguration()
        configuration.showsCursor = true
        configuration.captureResolution = .best
        configuration.sourceRect = sourceRect
        applyPixelSize(configuration, logicalSize: sourceRect.size, displayId: requestedDisplay)

        let filter = SCContentFilter(display: display, excludingWindows: [])
        return try encode(try captureImage(filter: filter, configuration: configuration))
    }

    func captureWindow(_ window: SCWindow) throws -> ScreenshotPayload {
        let configuration = SCStreamConfiguration()
        configuration.showsCursor = true
        configuration.captureResolution = .best
        let displayId = displayContaining(CGPoint(x: window.frame.midX, y: window.frame.midY))
        applyPixelSize(configuration, logicalSize: window.frame.size, displayId: displayId)
        let filter = SCContentFilter(desktopIndependentWindow: window)
        return try encode(try captureImage(filter: filter, configuration: configuration))
    }

    func captureApplication(
        _ app: NSRunningApplication,
        bounds: CGRect,
        displayId: CGDirectDisplayID
    ) throws -> ScreenshotPayload {
        let content = try shareableContent()
        guard let scApp = content.applications.first(where: { $0.processID == app.processIdentifier }) else {
            throw NativeFailure.notFound("Target application is unavailable for capture")
        }
        guard let display = content.displays.first(where: { $0.displayID == displayId }) else {
            throw NativeFailure.notFound("Target display is unavailable")
        }

        let displayBounds = CGDisplayBounds(displayId)
        let clippedBounds = bounds.intersection(displayBounds)
        guard !clippedBounds.isNull && !clippedBounds.isEmpty else {
            throw NativeFailure.invalid("Target application is outside the selected display")
        }

        let configuration = SCStreamConfiguration()
        configuration.showsCursor = true
        configuration.captureResolution = .best
        configuration.sourceRect = CGRect(
            x: clippedBounds.minX - displayBounds.minX,
            y: clippedBounds.minY - displayBounds.minY,
            width: clippedBounds.width,
            height: clippedBounds.height
        )
        applyPixelSize(configuration, logicalSize: clippedBounds.size, displayId: displayId)
        let filter = SCContentFilter(display: display, including: [scApp], exceptingWindows: [])
        return try encode(try captureImage(filter: filter, configuration: configuration))
    }

    func screenCaptureWindow(
        for element: AXUIElement,
        accessibility: AccessibilityController
    ) throws -> SCWindow {
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success,
              let bounds = accessibility.rect(element)
        else {
            throw NativeFailure.notFound("Target window metadata is unavailable")
        }

        let content = try shareableContent()
        let candidates = content.windows.filter {
            $0.owningApplication?.processID == pid
        }
        guard let matched = candidates.min(by: {
            windowDistance($0.frame, bounds) < windowDistance($1.frame, bounds)
        }) else {
            throw NativeFailure.notFound("Target window is unavailable for capture")
        }
        return matched
    }

    private func shareableContent() throws -> SCShareableContent {
        let semaphore = DispatchSemaphore(value: 0)
        var result: SCShareableContent?
        var resultError: Error?
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            result = content
            resultError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let resultError { throw resultError }
        guard let result else {
            throw NativeFailure.internalError("Screen content is unavailable")
        }
        return result
    }

    private func captureImage(
        filter: SCContentFilter,
        configuration: SCStreamConfiguration
    ) throws -> CGImage {
        let semaphore = DispatchSemaphore(value: 0)
        var result: CGImage?
        var resultError: Error?
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            result = image
            resultError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let resultError { throw resultError }
        guard let result else {
            throw NativeFailure.internalError("Screen capture failed")
        }
        return result
    }

    private func applyPixelSize(
        _ configuration: SCStreamConfiguration,
        logicalSize: CGSize,
        displayId: CGDirectDisplayID
    ) {
        let scale = screen(for: displayId)?.backingScaleFactor ?? 1
        configuration.width = max(1, Int(logicalSize.width * scale))
        configuration.height = max(1, Int(logicalSize.height * scale))
    }

    private func encode(_ image: CGImage) throws -> ScreenshotPayload {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            data as CFMutableData,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw NativeFailure.internalError("JPEG encoder is unavailable")
        }
        CGImageDestinationAddImage(
            destination,
            image,
            [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else {
            throw NativeFailure.internalError("JPEG encode failed")
        }
        return ScreenshotPayload(mimeType: "image/jpeg", data: (data as Data).base64EncodedString())
    }

    private func windowDistance(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        abs(lhs.minX - rhs.minX)
            + abs(lhs.minY - rhs.minY)
            + abs(lhs.width - rhs.width)
            + abs(lhs.height - rhs.height)
    }
}
