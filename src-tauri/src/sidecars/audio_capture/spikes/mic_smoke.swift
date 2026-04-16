import AVFoundation
import Foundation

let logPath = "/tmp/panes-mic-smoke.log"
FileManager.default.createFile(atPath: logPath, contents: nil)
let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logPath))

func log(_ msg: String) {
    print(msg)
    handle?.write((msg + "\n").data(using: .utf8)!)
}

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.inputFormat(forBus: 0)
log("input format: sampleRate=\(format.sampleRate) channels=\(format.channelCount)")

input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    guard let channelData = buffer.floatChannelData?[0] else { return }
    let frameLength = Int(buffer.frameLength)
    var sum: Float = 0
    for i in 0..<frameLength {
        sum += abs(channelData[i])
    }
    let avg = sum / Float(max(frameLength, 1))
    log(String(format: "amplitude: %.5f", avg))
}

do {
    try engine.start()
    log("capturing for 5 seconds — speak into the mic")
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 5.0))
    engine.stop()
    log("done")
} catch {
    log("error: \(error)")
    handle?.closeFile()
    exit(1)
}

handle?.closeFile()
