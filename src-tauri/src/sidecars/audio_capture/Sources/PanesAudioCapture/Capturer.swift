import Foundation

protocol Capturer: AnyObject {
    func start() throws
    func stop()
}

enum CaptureError: Error, CustomStringConvertible {
    case osStatus(String, OSStatus)
    case message(String)

    var description: String {
        switch self {
        case .osStatus(let op, let status): return "\(op) failed (OSStatus=\(status))"
        case .message(let m): return m
        }
    }
}
