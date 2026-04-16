import AVFoundation
import Foundation

struct Options {
    var outputPath: String?
    var durationSeconds: Double = 0
}

func printUsage() {
    let text = """
    panes-audio-capture — capture microphone audio and emit interleaved float32 PCM

    Usage:
      panes-audio-capture [--output-file <path>] [--duration <seconds>]

    Options:
      --output-file <path>   Write PCM to <path> instead of stdout.
      --duration <seconds>   Exit after N seconds. 0 (default) = run until SIGINT/SIGTERM.
      --help, -h             Show this help.

    Output:
      Interleaved float32 samples at the microphone's native sample rate and channel count.
      Format details are written to stderr at startup (look for "mic input format").

    Logs:
      All logs go to stderr. stdout is reserved for raw PCM when --output-file is not set.
    """
    FileHandle.standardError.write((text + "\n").data(using: .utf8)!)
}

func parseArgs() -> Options {
    var opts = Options()
    var iter = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = iter.next() {
        switch arg {
        case "--output-file":
            guard let value = iter.next() else {
                Logger.error("missing value for --output-file")
                exit(2)
            }
            opts.outputPath = value
        case "--duration":
            guard let value = iter.next(), let parsed = Double(value) else {
                Logger.error("missing or invalid value for --duration")
                exit(2)
            }
            opts.durationSeconds = parsed
        case "--help", "-h":
            printUsage()
            exit(0)
        default:
            Logger.error("unknown argument: \(arg)")
            printUsage()
            exit(2)
        }
    }
    return opts
}

protocol OutputSink: AnyObject {
    func write(_ data: Data)
    func close()
}

final class StdoutSink: OutputSink {
    private let handle = FileHandle.standardOutput
    func write(_ data: Data) { handle.write(data) }
    func close() {}
}

final class FileSink: OutputSink {
    private let handle: FileHandle
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
    func write(_ data: Data) { handle.write(data) }
    func close() { try? handle.close() }
}

let options = parseArgs()

let sink: OutputSink
if let path = options.outputPath {
    do {
        sink = try FileSink(path: path)
        Logger.info("writing PCM to file: \(path)")
    } catch {
        Logger.error("failed to open output file: \(error)")
        exit(3)
    }
} else {
    sink = StdoutSink()
    Logger.info("writing PCM to stdout")
}

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.inputFormat(forBus: 0)
Logger.info("mic input format: sampleRate=\(format.sampleRate) channels=\(format.channelCount) commonFormat=\(format.commonFormat.rawValue) interleaved=\(format.isInterleaved)")

input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak sink] buffer, _ in
    guard let sink = sink, let channelData = buffer.floatChannelData else { return }
    let frameLength = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    guard frameLength > 0 else { return }

    // AVAudioPCMBuffer delivers deinterleaved float32 channels; interleave for stdout consumers.
    var interleaved = [Float32](repeating: 0, count: frameLength * channelCount)
    for c in 0..<channelCount {
        let channel = channelData[c]
        for f in 0..<frameLength {
            interleaved[f * channelCount + c] = channel[f]
        }
    }
    interleaved.withUnsafeBufferPointer { ptr in
        sink.write(Data(buffer: ptr))
    }
}

let signalQueue = DispatchQueue(label: "dev.panes.audio-capture.signals")
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    Darwin.signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: signalQueue)
    source.setEventHandler {
        Logger.info("signal \(sig) received; stopping")
        input.removeTap(onBus: 0)
        engine.stop()
        sink.close()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

do {
    try engine.start()
    Logger.info("capture started")
} catch {
    Logger.error("failed to start engine: \(error)")
    exit(3)
}

if options.durationSeconds > 0 {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: options.durationSeconds))
    input.removeTap(onBus: 0)
    engine.stop()
    sink.close()
    Logger.info("duration complete; exiting")
    exit(0)
} else {
    RunLoop.current.run()
}
