import AudioToolbox
import CoreAudio
import Foundation

let logPath = "/tmp/panes-tap-smoke.log"
FileManager.default.createFile(atPath: logPath, contents: nil)
let logHandle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logPath))

func log(_ msg: String) {
    print(msg)
    logHandle?.write((msg + "\n").data(using: .utf8)!)
}

func fail(_ msg: String, _ err: OSStatus = noErr) -> Never {
    log("FATAL: \(msg) (OSStatus=\(err))")
    logHandle?.closeFile()
    exit(1)
}

func getUIDString(_ objectID: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var cfStr: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>>.size)
    let err = AudioObjectGetPropertyData(objectID, &addr, 0, nil, &size, &cfStr)
    guard err == noErr, let str = cfStr else { return nil }
    return str.takeRetainedValue() as String
}

var defaultOutputID: AudioDeviceID = 0
var sizeVar = UInt32(MemoryLayout<AudioDeviceID>.size)
var outputAddr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
var err = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &outputAddr,
    0, nil, &sizeVar, &defaultOutputID
)
guard err == noErr else { fail("get default output device", err) }
guard let outputUID = getUIDString(defaultOutputID, kAudioDevicePropertyDeviceUID) else {
    fail("get default output UID")
}
log("default output device UID: \(outputUID)")

let tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
tapDesc.uuid = UUID()
tapDesc.isPrivate = true

var tapID: AudioObjectID = kAudioObjectUnknown
err = AudioHardwareCreateProcessTap(tapDesc, &tapID)
guard err == noErr, tapID != kAudioObjectUnknown else {
    fail("create process tap", err)
}
guard let tapUID = getUIDString(tapID, kAudioTapPropertyUID) else {
    fail("get tap UID")
}
log("tap created, UID: \(tapUID)")

let aggregateDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey as String: "PanesTapAggregate",
    kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey as String: outputUID,
    kAudioAggregateDeviceIsPrivateKey as String: true,
    kAudioAggregateDeviceIsStackedKey as String: false,
    kAudioAggregateDeviceTapAutoStartKey as String: true,
    kAudioAggregateDeviceTapListKey as String: [
        [
            kAudioSubTapDriftCompensationKey as String: true,
            kAudioSubTapUIDKey as String: tapUID
        ]
    ]
]

var aggregateID: AudioDeviceID = 0
err = AudioHardwareCreateAggregateDevice(aggregateDesc as CFDictionary, &aggregateID)
guard err == noErr, aggregateID != kAudioObjectUnknown else {
    fail("create aggregate device", err)
}
log("aggregate device created, ID: \(aggregateID)")

final class Stats {
    var sum: Double = 0
    var frameCount: Int = 0
    var callbackCount: Int = 0
    var peakAbs: Float = 0
    var firstSamples: [Float] = []
    var bufferCount: Int = 0
    var bytesPerBuffer: Int = 0
}
let stats = Stats()
let ioQueue = DispatchQueue(label: "panes-audio-io", qos: .userInteractive)

var ioProcID: AudioDeviceIOProcID?
err = AudioDeviceCreateIOProcIDWithBlock(
    &ioProcID,
    aggregateID,
    ioQueue
) { (_, inInputData, _, _, _) in
    stats.callbackCount += 1
    let list = UnsafeMutableAudioBufferListPointer(
        UnsafeMutablePointer(mutating: inInputData)
    )
    for buffer in list {
        guard let data = buffer.mData else { continue }
        let frames = Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size
        let samples = data.assumingMemoryBound(to: Float32.self)
        for i in 0..<frames {
            stats.sum += Double(abs(samples[i]))
        }
        stats.frameCount += frames
    }
}
guard err == noErr, let ioProcID = ioProcID else { fail("create IOProc", err) }

err = AudioDeviceStart(aggregateID, ioProcID)
guard err == noErr else { fail("start aggregate device", err) }

log("capturing system audio for 6 seconds — play something (YouTube, Spotify, anything with sound)")
RunLoop.current.run(until: Date(timeIntervalSinceNow: 6.0))

AudioDeviceStop(aggregateID, ioProcID)

let meanAmp = stats.sum / Double(max(stats.frameCount, 1))
log("done. callbacks=\(stats.callbackCount) frames=\(stats.frameCount) mean|amp|=\(String(format: "%.6f", meanAmp))")
logHandle?.closeFile()
