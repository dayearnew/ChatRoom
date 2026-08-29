import Foundation
import Darwin

private func connectUnixSocket(path: String) throws -> FileHandle {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw POSIXError(.ECONNREFUSED) }

    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let maxLength = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < maxLength else {
        close(descriptor)
        throw POSIXError(.ENAMETOOLONG)
    }

    _ = path.withCString { source in
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: maxLength) { destination in
                strncpy(destination, source, maxLength - 1)
            }
        }
    }

    let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
            Darwin.connect(
                descriptor,
                socketAddress,
                socklen_t(MemoryLayout<sockaddr_un>.size)
            )
        }
    }
    guard result == 0 else {
        let code = errno
        close(descriptor)
        throw POSIXError(POSIXErrorCode(rawValue: code) ?? .ECONNREFUSED)
    }
    return FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
}

let server = ProtocolServer()
if let connectIndex = CommandLine.arguments.firstIndex(of: "--connect"),
   CommandLine.arguments.indices.contains(connectIndex + 1) {
    do {
        let socket = try connectUnixSocket(path: CommandLine.arguments[connectIndex + 1])
        server.run(input: socket, output: socket)
    } catch {
        fputs("ChatRoom Computer Helper: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else {
    server.run(input: .standardInput, output: .standardOutput)
}
