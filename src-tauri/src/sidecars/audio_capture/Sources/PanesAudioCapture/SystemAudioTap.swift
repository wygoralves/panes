import AudioToolbox
import CoreAudio
import Foundation

final class SystemAudioTap: Capturer {
    private let writer: FrameWriter
    private let ioQueue = DispatchQueue(
        label: "dev.panes.audio-capture.tap-io",
        qos: .userInteractive
    )

    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateID: AudioDeviceID = 0
    private var ioProcID: AudioDeviceIOProcID?
    private var sampleRate: UInt32 = 0
    private var channels: UInt8 = 0

    init(writer: @escaping FrameWriter) {
        self.writer = writer
    }

    func start() throws {
        let outputID = try Self.defaultOutputDeviceID()
        guard let outputUID = Self.stringProperty(
            outputID,
            kAudioDevicePropertyDeviceUID
        ) else {
            throw CaptureError.message("could not read default output device UID")
        }
        Logger.info("system output device UID: \(outputUID)")

        let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        tapDescription.uuid = UUID()
        tapDescription.isPrivate = true

        var newTapID: AudioObjectID = kAudioObjectUnknown
        var err = AudioHardwareCreateProcessTap(tapDescription, &newTapID)
        guard err == noErr, newTapID != kAudioObjectUnknown else {
            throw CaptureError.osStatus("AudioHardwareCreateProcessTap", err)
        }
        tapID = newTapID

        guard let tapUID = Self.stringProperty(newTapID, kAudioTapPropertyUID) else {
            throw CaptureError.message("could not read tap UID")
        }
        Logger.info("tap created UID=\(tapUID)")

        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "PanesAudioCaptureAggregate",
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
        var newAggregateID: AudioDeviceID = 0
        err = AudioHardwareCreateAggregateDevice(
            aggregateDescription as CFDictionary,
            &newAggregateID
        )
        guard err == noErr, newAggregateID != kAudioObjectUnknown else {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
            throw CaptureError.osStatus("AudioHardwareCreateAggregateDevice", err)
        }
        aggregateID = newAggregateID
        Logger.info("aggregate device created ID=\(newAggregateID)")

        let (rate, channelCount) = try Self.describeInputFormat(aggregateID: newAggregateID)
        sampleRate = rate
        channels = channelCount
        Logger.info("aggregate input format: sampleRate=\(rate) channels=\(channelCount)")

        var newIoProcID: AudioDeviceIOProcID?
        err = AudioDeviceCreateIOProcIDWithBlock(
            &newIoProcID,
            newAggregateID,
            ioQueue
        ) { [weak self] (_, inInputData, _, _, _) in
            self?.handleIOBuffer(inInputData)
        }
        guard err == noErr, let ioProc = newIoProcID else {
            AudioHardwareDestroyAggregateDevice(newAggregateID)
            aggregateID = 0
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
            throw CaptureError.osStatus("AudioDeviceCreateIOProcIDWithBlock", err)
        }
        ioProcID = ioProc

        err = AudioDeviceStart(newAggregateID, ioProc)
        guard err == noErr else {
            AudioDeviceDestroyIOProcID(newAggregateID, ioProc)
            ioProcID = nil
            AudioHardwareDestroyAggregateDevice(newAggregateID)
            aggregateID = 0
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
            throw CaptureError.osStatus("AudioDeviceStart", err)
        }
        Logger.info("system audio capture started")
    }

    func stop() {
        if let ioProc = ioProcID {
            AudioDeviceStop(aggregateID, ioProc)
            AudioDeviceDestroyIOProcID(aggregateID, ioProc)
            ioProcID = nil
        }
        if aggregateID != 0 {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = 0
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = kAudioObjectUnknown
        }
        Logger.info("system audio capture stopped")
    }

    private func handleIOBuffer(_ inputData: UnsafePointer<AudioBufferList>) {
        let list = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inputData)
        )
        for buffer in list {
            guard let bytes = buffer.mData else { continue }
            let byteCount = Int(buffer.mDataByteSize)
            guard byteCount > 0 else { continue }
            let samples = Data(bytes: bytes, count: byteCount)
            writer(.system, sampleRate, channels, samples)
        }
    }

    private static func defaultOutputDeviceID() throws -> AudioDeviceID {
        var deviceID: AudioDeviceID = 0
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let err = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0, nil,
            &size,
            &deviceID
        )
        guard err == noErr else {
            throw CaptureError.osStatus("get default output device", err)
        }
        return deviceID
    }

    private static func stringProperty(
        _ objectID: AudioObjectID,
        _ selector: AudioObjectPropertySelector
    ) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var cfStr: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>>.size)
        let err = AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, &cfStr)
        guard err == noErr, let str = cfStr else { return nil }
        return str.takeRetainedValue() as String
    }

    private static func describeInputFormat(aggregateID: AudioDeviceID) throws -> (UInt32, UInt8) {
        var streamDescription = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamFormat,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        let err = AudioObjectGetPropertyData(
            aggregateID,
            &address,
            0, nil,
            &size,
            &streamDescription
        )
        guard err == noErr else {
            throw CaptureError.osStatus("read aggregate input stream format", err)
        }
        let rate = UInt32(streamDescription.mSampleRate.rounded())
        let channelCount = UInt8(min(Int(streamDescription.mChannelsPerFrame), 255))
        return (rate, channelCount)
    }
}
