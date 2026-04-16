import AVFoundation
import Foundation

final class MicCapture: Capturer {
    private let engine = AVAudioEngine()
    private let writer: FrameWriter
    private var tapInstalled = false

    init(writer: @escaping FrameWriter) {
        self.writer = writer
    }

    func start() throws {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        let sampleRate = UInt32(format.sampleRate.rounded())
        let channels = UInt8(min(Int(format.channelCount), 255))

        Logger.info("mic input format: sampleRate=\(format.sampleRate) channels=\(format.channelCount) interleaved=\(format.isInterleaved)")

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.handleBuffer(buffer, sampleRate: sampleRate, channels: channels)
        }
        tapInstalled = true

        try engine.start()
        Logger.info("mic capture started")
    }

    func stop() {
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if engine.isRunning {
            engine.stop()
        }
        Logger.info("mic capture stopped")
    }

    private func handleBuffer(
        _ buffer: AVAudioPCMBuffer,
        sampleRate: UInt32,
        channels: UInt8
    ) {
        guard let channelData = buffer.floatChannelData else { return }
        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frameLength > 0 else { return }

        var interleaved = [Float32](repeating: 0, count: frameLength * channelCount)
        for c in 0..<channelCount {
            let channel = channelData[c]
            for f in 0..<frameLength {
                interleaved[f * channelCount + c] = channel[f]
            }
        }
        interleaved.withUnsafeBufferPointer { ptr in
            writer(.microphone, sampleRate, channels, Data(buffer: ptr))
        }
    }
}
