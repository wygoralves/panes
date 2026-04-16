import Foundation

/// A thread-safe byte sink. Implementations serialize `write(_:)` so that frames
/// produced by multiple capture callbacks do not interleave mid-chunk.
protocol OutputSink: AnyObject {
    func write(_ data: Data)
    func close()
}

/// Writes to the process' stdout. All writes are serialized with an NSLock.
final class StdoutSink: OutputSink {
    private let handle = FileHandle.standardOutput
    private let lock = NSLock()

    func write(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        handle.write(data)
    }

    func close() {}
}

/// Writes to a file at `path`. All writes are serialized with an NSLock.
final class FileSink: OutputSink {
    private let handle: FileHandle
    private let lock = NSLock()

    init(path: String) throws {
        FileManager.default.createFile(atPath: path, contents: nil)
        guard let h = FileHandle(forWritingAtPath: path) else {
            throw NSError(
                domain: "PanesAudioCapture",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "cannot open output file: \(path)"]
            )
        }
        self.handle = h
    }

    func write(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        handle.write(data)
    }

    func close() {
        lock.lock()
        defer { lock.unlock() }
        try? handle.close()
    }
}

/// Identifies the source of a frame in `--mode both` output.
enum SourceID: UInt8 {
    case microphone = 0
    case system = 1
}

/// Emits a raw or framed chunk of interleaved float32 samples. Capturers call this
/// for every buffer they produce. `main.swift` chooses the implementation based on
/// `--mode`: raw for single-source modes, framed for `--mode both`.
///
/// Frame layout (framed mode):
///   [1 byte]  sourceId          (0 = mic, 1 = system)
///   [4 bytes] sampleRate        u32 little-endian, Hz
///   [1 byte]  channels
///   [4 bytes] sampleCount       u32 little-endian (number of float32 samples,
///                                  including all channels, i.e. frames * channels)
///   [N*4 bytes] samples         interleaved float32
typealias FrameWriter = (_ source: SourceID, _ sampleRate: UInt32, _ channels: UInt8, _ samples: Data) -> Void

enum FrameWriterFactory {
    static func raw(sink: OutputSink) -> FrameWriter {
        return { _, _, _, samples in
            sink.write(samples)
        }
    }

    static func framed(sink: OutputSink) -> FrameWriter {
        return { source, sampleRate, channels, samples in
            var header = Data(capacity: 10)
            header.append(source.rawValue)
            var rate = sampleRate.littleEndian
            withUnsafeBytes(of: &rate) { header.append(contentsOf: $0) }
            header.append(channels)
            var count = UInt32(samples.count / MemoryLayout<Float32>.size).littleEndian
            withUnsafeBytes(of: &count) { header.append(contentsOf: $0) }
            sink.write(header + samples)
        }
    }
}
