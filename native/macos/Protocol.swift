import Foundation

private let nativeProtocolVersion = 1

enum ProtocolMethod: String {
    case status
    case requestPermission
    case snapshot
    case action
}

private struct RequestEnvelope: Decodable {
    let protocolVersion: Int
    let id: String
    let method: String

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case id
        case method
    }
}

private struct RequestWithParams<T: Decodable>: Decodable {
    let params: T
}

private struct SuccessEnvelope<T: Encodable>: Encodable {
    let protocolVersion = nativeProtocolVersion
    let id: String
    let result: T

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case id
        case result
    }
}

private struct ErrorBody: Encodable {
    let code: String
    let message: String
}

private struct ErrorEnvelope: Encodable {
    let protocolVersion = nativeProtocolVersion
    let id: String
    let error: ErrorBody

    enum CodingKeys: String, CodingKey {
        case protocolVersion = "protocol"
        case id
        case error
    }
}

final class ProtocolServer {
    private let session = ComputerSession()
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private var output = FileHandle.standardOutput

    func run(input: FileHandle, output: FileHandle) {
        self.output = output
        var buffer = Data()
        while true {
            let chunk = input.availableData
            if chunk.isEmpty { break }
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 10) {
                let line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                if !line.isEmpty { handle(line) }
            }
        }
    }

    private func handle(_ data: Data) {
        let envelope: RequestEnvelope
        do {
            envelope = try decoder.decode(RequestEnvelope.self, from: data)
        } catch {
            return
        }

        do {
            guard envelope.protocolVersion == nativeProtocolVersion else {
                throw NativeFailure.unsupported(
                    "Unsupported Computer protocol version: \(envelope.protocolVersion)"
                )
            }
            guard let method = ProtocolMethod(rawValue: envelope.method) else {
                throw NativeFailure.unsupported("Unknown Computer protocol method: \(envelope.method)")
            }
            switch method {
            case .status:
                try send(envelope.id, session.status())

            case .requestPermission:
                let request: PermissionRequest = try decodeParams(data)
                session.requestPermission(request.permission)
                try send(envelope.id, session.status())

            case .snapshot:
                let request: SnapshotRequest = try decodeParams(data)
                try send(envelope.id, session.snapshot(request))

            case .action:
                let request: ActionRequest = try decodeParams(data)
                try send(envelope.id, session.action(request))
            }
        } catch let failure as NativeFailure {
            sendError(envelope.id, failure)
        } catch is DecodingError {
            sendError(envelope.id, .invalid("Invalid parameters for \(envelope.method)"))
        } catch {
            sendError(
                envelope.id,
                .internalError(error.localizedDescription)
            )
        }
    }

    private func decodeParams<T: Decodable>(_ data: Data) throws -> T {
        try decoder.decode(RequestWithParams<T>.self, from: data).params
    }

    private func send<T: Encodable>(_ id: String, _ result: T) throws {
        try emit(SuccessEnvelope(id: id, result: result))
    }

    private func sendError(_ id: String, _ failure: NativeFailure) {
        try? emit(
            ErrorEnvelope(
                id: id,
                error: ErrorBody(code: failure.code, message: failure.message)
            )
        )
    }

    private func emit<T: Encodable>(_ value: T) throws {
        output.write(try encoder.encode(value))
        output.write(Data([10]))
    }
}
