import Foundation

enum CaptureMode: String {
    case mic
    case system
    case both
}

struct Options {
    var outputPath: String?
    var durationSeconds: Double = 0
    var mode: CaptureMode = .mic
}

func printUsage() {
    let text = """
    panes-audio-capture — capture audio and emit PCM samples

    Usage:
      panes-audio-capture [--mode <mic|system|both>] [--output-file <path>] [--duration <seconds>]

    Options:
      --mode <mic|system|both>
          mic    = microphone via AVAudioEngine; output = raw interleaved float32 at mic rate.
          system = system output via Core Audio process tap; output = raw interleaved float32
                   at the aggregate device's sample rate.
          both   = mic + system captured concurrently; output = length-prefixed frames, each
                   tagged with its source. Frame layout:
                     u8  sourceId   (0 = mic, 1 = system)
                     u32 sampleRate (little-endian, Hz)
                     u8  channels
                     u32 sampleCount (little-endian, float32 count including channels)
                     f32[sampleCount] interleaved samples
          Default: mic.

      --output-file <path>
          Write to <path> instead of stdout.

      --duration <seconds>
          Exit after N seconds. 0 (default) = run until SIGINT/SIGTERM.

      --help, -h
          Show this help.

    Logs go to stderr. stdout (or the output file) contains only PCM bytes.
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
                Logger.error("invalid or missing value for --mode (expected mic, system, or both)")
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

let writer: FrameWriter
switch options.mode {
case .mic, .system:
    writer = FrameWriterFactory.raw(sink: sink)
case .both:
    writer = FrameWriterFactory.framed(sink: sink)
}

var capturers: [Capturer] = []
switch options.mode {
case .mic:
    capturers.append(MicCapture(writer: writer))
case .system:
    capturers.append(SystemAudioTap(writer: writer))
case .both:
    capturers.append(MicCapture(writer: writer))
    capturers.append(SystemAudioTap(writer: writer))
}
Logger.info("capture mode: \(options.mode.rawValue)")

let signalQueue = DispatchQueue(label: "dev.panes.audio-capture.signals")
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    Darwin.signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: signalQueue)
    source.setEventHandler {
        Logger.info("signal \(sig) received; stopping")
        for c in capturers { c.stop() }
        sink.close()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

for capturer in capturers {
    do {
        try capturer.start()
    } catch {
        Logger.error("capture start failed: \(error)")
        for c in capturers { c.stop() }
        sink.close()
        exit(3)
    }
}

if options.durationSeconds > 0 {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: options.durationSeconds))
    for capturer in capturers {
        capturer.stop()
    }
    sink.close()
    Logger.info("duration complete; exiting")
    exit(0)
} else {
    RunLoop.current.run()
}
