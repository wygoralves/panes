import Foundation

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
