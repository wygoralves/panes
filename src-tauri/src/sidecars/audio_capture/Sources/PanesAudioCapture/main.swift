import Foundation

enum CaptureMode: String {
    case mic
    case system
}

struct Options {
    var outputPath: String?
    var durationSeconds: Double = 0
    var mode: CaptureMode = .mic
}

func printUsage() {
    let text = """
    panes-audio-capture — capture audio and emit raw PCM samples

    Usage:
      panes-audio-capture [--mode <mic|system>] [--output-file <path>] [--duration <seconds>]

    Options:
      --mode <mic|system>    Capture source. Default: mic.
                             mic    = microphone via AVAudioEngine (mono or stereo float32).
                             system = system output via Core Audio process tap
                                      (stereo float32 at the default output device's rate).
      --output-file <path>   Write PCM to <path> instead of stdout.
      --duration <seconds>   Exit after N seconds. 0 (default) = run until SIGINT/SIGTERM.
      --help, -h             Show this help.

    Output format details are logged to stderr at startup.
    Logs go to stderr. stdout is reserved for raw PCM when --output-file is not set.
    """
    FileHandle.standardError.write((text + "\n").data(using: .utf8)!)
}

func parseArgs() -> Options {
    var opts = Options()
    var iter = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = iter.next() {
        switch arg {
        case "--mode":
            guard let value = iter.next(), let mode = CaptureMode(rawValue: value) else {
                Logger.error("invalid or missing value for --mode (expected mic or system)")
                exit(2)
            }
            opts.mode = mode
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

let capturer: Capturer
switch options.mode {
case .mic:
    capturer = MicCapture(sink: sink)
case .system:
    capturer = SystemAudioTap(sink: sink)
}
Logger.info("capture mode: \(options.mode.rawValue)")

let signalQueue = DispatchQueue(label: "dev.panes.audio-capture.signals")
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    Darwin.signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: signalQueue)
    source.setEventHandler {
        Logger.info("signal \(sig) received; stopping")
        capturer.stop()
        sink.close()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

do {
    try capturer.start()
} catch {
    Logger.error("capture start failed: \(error)")
    exit(3)
}

if options.durationSeconds > 0 {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: options.durationSeconds))
    capturer.stop()
    sink.close()
    Logger.info("duration complete; exiting")
    exit(0)
} else {
    RunLoop.current.run()
}
