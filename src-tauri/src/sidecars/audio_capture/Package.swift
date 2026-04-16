// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PanesAudioCapture",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "PanesAudioCapture",
            path: "Sources/PanesAudioCapture"
        )
    ]
)
