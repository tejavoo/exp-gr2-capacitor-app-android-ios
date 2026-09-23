import Foundation
import UIKit

/// network queue ──► newest-JPEG slot ──► decode queue ──► newest-UIImage slot ──► main thread
///
/// Each slot keeps only the newest item, so the picture never lags behind the camera.
/// Images are fully decoded off the main thread (`preparingForDisplay`), so assigning them
/// to the UIImageView never blocks scrolling or touches.
final class MjpegStreamer: NSObject, URLSessionDataDelegate {

    var onState: ((String, String?) -> Void)?
    var onStats: (([String: Any]) -> Void)?

    private weak var imageView: UIImageView?
    private var url: URL
    private let headers: [String: String]
    private let stall: TimeInterval

    private let netQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.name = "mjpeg.net"
        return q
    }()
    private let decodeQueue = DispatchQueue(label: "mjpeg.decode", qos: .userInitiated)
    private let lock = NSLock()

    private var session: URLSession?
    private var task: URLSessionDataTask?
    private let parser = MjpegParser()
    private var statsTimer: Timer?

    // guarded by lock
    private var running = true
    private var paused = false
    private var latestJpeg: Data?
    private var decodeScheduled = false
    private var pendingImage: UIImage?
    private var uiScheduled = false
    private var dropped = 0
    private var width = 0
    private var height = 0

    // net queue only
    private var framesMode = false
    private var framesThisResponse = 0
    private var failures = 0
    private var contentType = ""

    // main only
    private var drawn = 0

    init(url: URL, headers: [String: String], stall: TimeInterval, imageView: UIImageView) {
        self.url = url
        self.headers = headers
        self.stall = stall
        self.imageView = imageView
        super.init()
    }

    // MARK: - Control

    func start() {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = stall   // idle time between packets → stall watchdog
        config.httpMaximumConnectionsPerHost = 1
        config.waitsForConnectivity = false
        session = URLSession(configuration: config, delegate: self, delegateQueue: netQueue)
        emitState("connecting", nil)
        netQueue.addOperation { self.connect() }

        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.emitStats() }
        RunLoop.main.add(timer, forMode: .common)
        statsTimer = timer
    }

    func stop() {
        lock.lock(); running = false; lock.unlock()
        statsTimer?.invalidate()
        statsTimer = nil
        task?.cancel()
        session?.invalidateAndCancel()   // breaks the session → delegate retain cycle
        session = nil
        emitState("stopped", nil)
    }

    func pause() {
        lock.lock(); paused = true; lock.unlock()
        task?.cancel()
        emitState("paused", nil)
    }

    func resume() {
        lock.lock()
        let wasPaused = paused
        paused = false
        lock.unlock()
        guard wasPaused else { return }
        netQueue.addOperation {
            self.emitState(self.framesMode ? "frames" : "connecting", nil)
            self.connect()
        }
    }

    func setUrl(_ newUrl: URL) {
        netQueue.addOperation {
            self.url = newUrl
            self.framesMode = false
            self.task?.cancel()   // didComplete (cancelled) reconnects to the new URL
        }
    }

    // MARK: - Network (netQueue)

    private var isActive: Bool {
        lock.lock(); defer { lock.unlock() }
        return running && !paused
    }

    private func connect() {
        guard isActive, let session = session else { return }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: stall)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        parser.reset()
        framesThisResponse = 0
        let t = session.dataTask(with: req)
        task = t
        t.resume()
    }

    private func reconnect(after delay: TimeInterval) {
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.netQueue.addOperation { self?.connect() }
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        contentType = http?.value(forHTTPHeaderField: "Content-Type") ?? ""
        guard http?.statusCode == 200 else {
            failures += 1
            emitState("error", "HTTP \(http?.statusCode ?? 0)")
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask == task, isActive else { return }
        parser.feed(data) { jpeg in self.onFrame(jpeg) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task == self.task else { return }
        self.task = nil
        guard isActive else { return }

        if let ns = error as NSError? {
            if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled {
                // setUrl() or a bad status cancelled the task.
                reconnect(after: failures > 0 ? backoff() : 0)
            } else if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorTimedOut {
                emitState("stalled", "No frame for \(Int(stall * 1000)) ms — reconnecting")
                reconnect(after: 0.3)
            } else {
                failures += 1
                let wait = backoff()
                emitState("error", "\(ns.localizedDescription) — retry in \(Int(wait * 1000)) ms")
                reconnect(after: wait)
            }
            return
        }

        failures = 0
        if !framesMode && framesThisResponse <= 1 {
            framesMode = true   // one JPEG per request: chain requests back-to-back
            emitState("frames", "Camera sends single images; chaining requests")
            reconnect(after: 0)
        } else {
            reconnect(after: framesMode ? 0 : 0.25)
        }
    }

    private func backoff() -> TimeInterval {
        min(0.5 * pow(2, Double(min(failures, 4))), 5)
    }

    private func onFrame(_ jpeg: Data) {
        framesThisResponse += 1
        if framesThisResponse == 1 && !framesMode { emitState("streaming", nil) }
        failures = 0

        lock.lock()
        if latestJpeg != nil { dropped += 1 }
        latestJpeg = jpeg
        let schedule = !decodeScheduled
        decodeScheduled = true
        lock.unlock()
        if schedule { decodeQueue.async { self.decode() } }
    }

    // MARK: - Decode (decodeQueue)

    private func decode() {
        lock.lock()
        decodeScheduled = false
        let jpeg = latestJpeg
        latestJpeg = nil
        let alive = running
        lock.unlock()
        guard alive, let jpeg = jpeg, let image = UIImage(data: jpeg) else { return }
        let ready = image.preparingForDisplay() ?? image

        lock.lock()
        if pendingImage != nil { dropped += 1 }
        pendingImage = ready
        width = Int(image.size.width * image.scale)
        height = Int(image.size.height * image.scale)
        let post = !uiScheduled
        uiScheduled = true
        lock.unlock()
        if post { DispatchQueue.main.async { self.draw() } }
    }

    // MARK: - UI (main)

    private func draw() {
        lock.lock()
        uiScheduled = false
        let image = pendingImage
        pendingImage = nil
        let alive = running
        lock.unlock()
        guard alive, let image = image else { return }
        imageView?.image = image
        drawn += 1
    }

    private func emitStats() {
        lock.lock()
        let d = dropped, w = width, h = height
        dropped = 0
        lock.unlock()
        let fps = drawn
        drawn = 0
        let ct = contentType
        let mode = framesMode ? "frames" : "stream"
        onStats?(["fps": fps, "dropped": d, "width": w, "height": h, "contentType": ct, "mode": mode])
    }

    private func emitState(_ state: String, _ message: String?) {
        DispatchQueue.main.async { self.onState?(state, message) }
    }
}
