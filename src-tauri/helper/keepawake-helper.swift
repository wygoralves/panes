// PanesKeepAwakeHelper — privileged daemon that toggles system-wide sleep
// prevention via IOPMSetSystemPowerSetting("SleepDisabled", ...).
//
// Runs as root via launchd (registered through SMAppService). Listens on a
// Unix domain socket for JSON commands from the main Panes app.
//
// Protocol (newline-delimited JSON):
//   → {"action":"preventSleep"}   ← {"ok":true}
//   → {"action":"allowSleep"}     ← {"ok":true}
//   → {"action":"status"}         ← {"sleepDisabled":true}
//
// Crash recovery: on startup, unconditionally restores sleep (clears any
// stale SleepDisabled=true left by a prior crash). The app reconnects and
// re-sends preventSleep when needed.

import Foundation
import SystemConfiguration

// MARK: - IOKit Private SPI

// IOPMSetSystemPowerSetting is declared in IOPMLibPrivate.h. It writes to
// /Library/Preferences/SystemConfiguration/com.apple.PowerManagement.plist
// and sends a Mach message that sets userDisabledAllSleep in IOPMrootDomain.
// Requires root.
@_silgen_name("IOPMSetSystemPowerSetting")
func IOPMSetSystemPowerSetting(_ key: CFString, _ value: CFTypeRef) -> Int32

// IOPMCopySystemPowerSettings reads the current system power settings dict.
// Does NOT require root.
@_silgen_name("IOPMCopySystemPowerSettings")
func IOPMCopySystemPowerSettings() -> Unmanaged<CFDictionary>?

private let kSleepDisabledKey = "SleepDisabled" as CFString
private let socketPath = "/var/run/com.panes.app.keepawake.sock"

// MARK: - Sleep control

func preventSleep() -> Int32 {
    IOPMSetSystemPowerSetting(kSleepDisabledKey, kCFBooleanTrue)
}

func allowSleep() -> Int32 {
    IOPMSetSystemPowerSetting(kSleepDisabledKey, kCFBooleanFalse)
}

func isSleepDisabled() -> Bool {
    guard let settingsRef = IOPMCopySystemPowerSettings() else { return false }
    let settings = settingsRef.takeRetainedValue() as NSDictionary
    return (settings["SleepDisabled"] as? Bool) ?? false
}

// MARK: - Socket server

func removeStaleSocket() {
    unlink(socketPath)
}

func createListenSocket() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
        NSLog("PanesKeepAwakeHelper: failed to create socket: \(errno)")
        return -1
    }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = socketPath.utf8CString
    guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
        NSLog("PanesKeepAwakeHelper: socket path too long")
        close(fd)
        return -1
    }
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        let raw = UnsafeMutableRawPointer(ptr)
        pathBytes.withUnsafeBufferPointer { buf in
            raw.copyMemory(from: buf.baseAddress!, byteCount: buf.count)
        }
    }

    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard bindResult == 0 else {
        NSLog("PanesKeepAwakeHelper: failed to bind socket: \(errno)")
        close(fd)
        return -1
    }

    // Restrict socket to the console user. Fail closed: if we cannot
    // determine the console user, refuse to create the socket rather than
    // making it world-writable.
    var consoleUid: uid_t = 0
    var consoleGid: gid_t = 0
    guard let _ = SCDynamicStoreCopyConsoleUser(nil, &consoleUid, &consoleGid) else {
        NSLog("PanesKeepAwakeHelper: no console user found, refusing to create socket")
        close(fd)
        unlink(socketPath)
        return -1
    }
    chown(socketPath, consoleUid, consoleGid)
    chmod(socketPath, 0o600)

    guard listen(fd, 2) == 0 else {
        NSLog("PanesKeepAwakeHelper: failed to listen on socket: \(errno)")
        close(fd)
        return -1
    }

    return fd
}

func handleConnection(_ clientFd: Int32) {
    defer { close(clientFd) }

    // Verify the connecting process belongs to the console user.
    var peerUid: uid_t = 0
    var peerGid: gid_t = 0
    if getpeereid(clientFd, &peerUid, &peerGid) == 0 {
        var consoleUid: uid_t = 0
        if let _ = SCDynamicStoreCopyConsoleUser(nil, &consoleUid, nil),
           peerUid != consoleUid && peerUid != 0 {
            NSLog("PanesKeepAwakeHelper: rejected connection from uid \(peerUid) (console uid \(consoleUid))")
            return
        }
    }

    // Read up to 1KB — commands are small JSON objects.
    var buffer = [UInt8](repeating: 0, count: 1024)
    let bytesRead = read(clientFd, &buffer, buffer.count - 1)
    guard bytesRead > 0 else { return }

    let data = Data(bytes: buffer, count: bytesRead)
    let action: String
    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let parsed = json["action"] as? String {
        action = parsed
    } else {
        action = ""
    }

    let response: String
    switch action {
    case "preventSleep":
        let result = preventSleep()
        response = result == 0
            ? "{\"ok\":true}\n"
            : "{\"ok\":false,\"error\":\"IOReturn \(result)\"}\n"
    case "allowSleep":
        let result = allowSleep()
        response = result == 0
            ? "{\"ok\":true}\n"
            : "{\"ok\":false,\"error\":\"IOReturn \(result)\"}\n"
    case "status":
        let disabled = isSleepDisabled()
        response = "{\"sleepDisabled\":\(disabled)}\n"
    default:
        response = "{\"ok\":false,\"error\":\"unknown action\"}\n"
    }

    response.utf8CString.withUnsafeBufferPointer { buf in
        // buf includes the null terminator; write everything except it.
        _ = write(clientFd, buf.baseAddress!, buf.count - 1)
    }
}

// MARK: - Signal handling

private var listenFd: Int32 = -1

func installSignalHandlers() {
    signal(SIGTERM) { _ in
        NSLog("PanesKeepAwakeHelper: received SIGTERM, restoring sleep")
        _ = allowSleep()
        if listenFd >= 0 { close(listenFd) }
        unlink(socketPath)
        exit(0)
    }
    signal(SIGINT) { _ in
        NSLog("PanesKeepAwakeHelper: received SIGINT, restoring sleep")
        _ = allowSleep()
        if listenFd >= 0 { close(listenFd) }
        unlink(socketPath)
        exit(0)
    }
}

// MARK: - Entry point

@main
enum PanesKeepAwakeHelper {
    static func main() {
        installSignalHandlers()

        // Crash recovery: clear any stale SleepDisabled from a prior run.
        if isSleepDisabled() {
            NSLog("PanesKeepAwakeHelper: clearing stale SleepDisabled on startup")
            _ = allowSleep()
        }

        removeStaleSocket()
        listenFd = createListenSocket()
        guard listenFd >= 0 else {
            NSLog("PanesKeepAwakeHelper: exiting — could not create listen socket")
            Foundation.exit(1)
        }

        NSLog("PanesKeepAwakeHelper: listening on \(socketPath)")

        // Accept loop — single-threaded, one connection at a time.
        // The Panes app sends short commands and reads the response immediately,
        // so blocking accept is fine.
        while true {
            let clientFd = accept(listenFd, nil, nil)
            guard clientFd >= 0 else {
                if errno == EINTR { continue }
                NSLog("PanesKeepAwakeHelper: accept failed: \(errno)")
                break
            }
            handleConnection(clientFd)
        }

        _ = allowSleep()
        close(listenFd)
        unlink(socketPath)
    }
}
