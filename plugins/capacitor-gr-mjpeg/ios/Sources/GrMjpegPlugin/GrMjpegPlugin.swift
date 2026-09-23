import Foundation
import Capacitor
import UIKit

/// Native MJPEG viewer drawn UNDER a transparent WKWebView, so HTML overlays (HUD,
/// tap-to-focus) stay on top and interactive. Frames never cross the JS bridge.
@objc(GrMjpegPlugin)
public class GrMjpegPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GrMjpegPlugin"
    public let jsName = "GrMjpeg"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var container: UIView?
    private var imageView: UIImageView?
    private var streamer: MjpegStreamer?
    private var pausedByJs = false

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(appDidEnterBackground),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillEnterForeground),
                       name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func appDidEnterBackground() { streamer?.pause() }
    @objc private func appWillEnterForeground() { if !pausedByJs { streamer?.resume() } }

    @objc func start(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              let rect = call.getObject("rect") else {
            call.reject("url and rect are required")
            return
        }
        let stall = TimeInterval(call.getInt("stallTimeoutMs") ?? 4000) / 1000
        let background = Self.color(call.getString("backgroundColor") ?? "#000000")
        var headers: [String: String] = [:]
        for (k, v) in call.getObject("headers") ?? [:] {
            if let s = v as? String { headers[k] = s }
        }

        DispatchQueue.main.async {
            self.teardown()
            guard let webView = self.webView, let host = webView.superview else {
                call.reject("No web view")
                return
            }

            let container = UIView(frame: host.bounds)
            container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.backgroundColor = background
            container.isUserInteractionEnabled = false
            host.insertSubview(container, belowSubview: webView)

            let imageView = UIImageView()
            imageView.contentMode = .scaleAspectFit
            imageView.backgroundColor = .black
            container.addSubview(imageView)
            self.container = container
            self.imageView = imageView
            self.apply(rect: rect)

            // Let the native view show through the page.
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear

            let streamer = MjpegStreamer(url: url, headers: headers, stall: stall, imageView: imageView)
            streamer.onState = { [weak self] state, message in
                var e: JSObject = ["state": state]
                if let message = message { e["message"] = message }
                self?.notifyListeners("state", data: e)
            }
            streamer.onStats = { [weak self] stats in
                var e: JSObject = [:]
                for (k, v) in stats {
                    if let n = v as? Int { e[k] = n } else if let s = v as? String { e[k] = s }
                }
                self?.notifyListeners("stats", data: e)
            }
            self.pausedByJs = false
            self.streamer = streamer
            streamer.start()
            call.resolve()
        }
    }

    @objc func setRect(_ call: CAPPluginCall) {
        let rect = call.options as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            self.apply(rect: rect)
            call.resolve()
        }
    }

    @objc func setUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("url is required")
            return
        }
        streamer?.setUrl(url)
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        pausedByJs = true
        streamer?.pause()
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        pausedByJs = false
        streamer?.resume()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown()
            call.resolve()
        }
    }

    // MARK: - Helpers

    /// CSS px (relative to the web view's viewport) == points; offset by the web view's frame.
    private func apply(rect: [String: Any]) {
        guard let imageView = imageView, let webView = webView else { return }
        func num(_ k: String) -> CGFloat { CGFloat((rect[k] as? NSNumber)?.doubleValue ?? 0) }
        imageView.frame = CGRect(x: webView.frame.minX + num("x"),
                                 y: webView.frame.minY + num("y"),
                                 width: max(0, num("width")),
                                 height: max(0, num("height")))
    }

    private func teardown() {
        streamer?.stop()
        streamer = nil
        container?.removeFromSuperview()
        container = nil
        imageView = nil
    }

    private static func color(_ hex: String) -> UIColor {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return .black }
        let hasAlpha = s.count == 8
        let r = CGFloat((v >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let g = CGFloat((v >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let b = CGFloat((v >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let a = hasAlpha ? CGFloat(v & 0xFF) / 255 : 1
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }
}
