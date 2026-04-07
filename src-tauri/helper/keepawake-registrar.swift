// PanesHelperRegistrar — thin utility that registers/unregisters the
// privileged helper daemon via SMAppService (macOS 13+) and reports status.
//
// Usage:
//   PanesHelperRegistrar --status     → {"status":"..."}
//   PanesHelperRegistrar --register   → {"status":"..."}
//   PanesHelperRegistrar --unregister → {"status":"..."}
//
// The status string maps SMAppService.Status:
//   .notRegistered    → "notRegistered"
//   .enabled          → "registered"
//   .requiresApproval → "requiresApproval"
//   .notFound         → "notFound"

import Foundation
import ServiceManagement

private let plistName = "com.panes.app.helper.keepawake.plist"

func statusString(_ status: SMAppService.Status) -> String {
    switch status {
    case .notRegistered:    return "notRegistered"
    case .enabled:          return "registered"
    case .requiresApproval: return "requiresApproval"
    case .notFound:         return "notFound"
    @unknown default:       return "unknown"
    }
}

func printJSON(_ dict: [String: String]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

let service = SMAppService.daemon(plistName: plistName)
let args = CommandLine.arguments

if args.contains("--register") {
    do {
        try service.register()
        printJSON(["status": statusString(service.status)])
    } catch {
        printJSON(["status": statusString(service.status), "error": error.localizedDescription])
        exit(1)
    }
} else if args.contains("--unregister") {
    do {
        try service.unregister()
        printJSON(["status": "notRegistered"])
    } catch {
        printJSON(["status": statusString(service.status), "error": error.localizedDescription])
        exit(1)
    }
} else {
    // --status (default)
    printJSON(["status": statusString(service.status)])
}
