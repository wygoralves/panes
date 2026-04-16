// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PanesAudioCapture",
    platforms: [.macOS("14.2")],
    targets: [
        .executableTarget(
            name: "PanesAudioCapture",
            path: "Sources/PanesAudioCapture"
        )
    ]
)
