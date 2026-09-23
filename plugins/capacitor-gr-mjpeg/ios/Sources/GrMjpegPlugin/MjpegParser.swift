import Foundation

/// Incremental MJPEG frame splitter (same algorithm as the web app's liveStream.ts and the
/// Android MjpegParser). Prefers the multipart part's Content-Length when its headers end
/// exactly where the JPEG starts; otherwise cuts on SOI (FF D8) … EOI (FF D9).
/// Not thread-safe — use from one queue.
final class MjpegParser {
    static let maxFrame = 4 * 1024 * 1024
    private static let headerWindow = 256

    private var buf: [UInt8] = []
    private var start = -1
    private var scanFrom = 0

    init() { buf.reserveCapacity(256 * 1024) }

    func reset() {
        buf.removeAll(keepingCapacity: true)
        start = -1
        scanFrom = 0
    }

    func feed(_ data: Data, onFrame: (Data) -> Void) {
        buf.append(contentsOf: data)
        var consumed = 0

        while true {
            if start < 0 {
                start = find(0xD8, from: max(consumed, scanFrom))
                if start < 0 {
                    // Keep a tail: FF D8 may straddle chunks, and the part headers that
                    // precede the next JPEG must survive until it arrives.
                    consumed = max(consumed, buf.count - Self.headerWindow)
                    scanFrom = max(consumed, buf.count - 1)
                    break
                }
            }

            let declared = partLength(start)
            if declared > 0 {
                if buf.count < start + declared { break }
                onFrame(Data(buf[start..<(start + declared)]))
                consumed = start + declared
                start = -1
                scanFrom = consumed
                continue
            }

            let end = find(0xD9, from: max(start + 2, scanFrom))
            if end < 0 {
                scanFrom = max(start + 2, buf.count - 1)
                if buf.count - start > Self.maxFrame { // garbage — resync
                    consumed = buf.count
                    start = -1
                    scanFrom = buf.count
                }
                break
            }
            onFrame(Data(buf[start..<(end + 2)]))
            consumed = end + 2
            start = -1
            scanFrom = consumed
        }
        compact(consumed)
    }

    private func compact(_ consumed: Int) {
        guard consumed > 0 else { return }
        buf.removeFirst(min(consumed, buf.count))
        if start >= 0 { start -= consumed }
        scanFrom = max(0, scanFrom - consumed)
    }

    private func find(_ second: UInt8, from: Int) -> Int {
        let n = buf.count
        var i = max(0, from)
        return buf.withUnsafeBufferPointer { p -> Int in
            while i < n - 1 {
                if p[i] == 0xFF && p[i + 1] == second { return i }
                i += 1
            }
            return -1
        }
    }

    /// Content-Length from part headers ending ("\r\n\r\n") exactly where the JPEG starts.
    private func partLength(_ jpegStart: Int) -> Int {
        guard jpegStart >= 16 else { return 0 }
        // Compare bytes: in a Swift String "\r\n" is ONE Character, so character math is wrong here.
        guard buf[jpegStart - 4] == 13, buf[jpegStart - 3] == 10,
              buf[jpegStart - 2] == 13, buf[jpegStart - 1] == 10 else { return 0 }
        let from = max(0, jpegStart - Self.headerWindow)
        let head = String(decoding: buf[from..<jpegStart], as: Unicode.ASCII.self)
        let partStart = head.range(of: "--", options: .backwards)?.lowerBound ?? head.startIndex
        let part = head[partStart...].lowercased()
        guard let key = part.range(of: "content-length:") else { return 0 }
        let digits = part[key.upperBound...].drop { $0 == " " }.prefix { $0.isNumber }
        guard let value = Int(digits), value > 0, value < Self.maxFrame else { return 0 }
        return value
    }
}
