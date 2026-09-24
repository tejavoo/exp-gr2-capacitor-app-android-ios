import Foundation
import Capacitor
import Network
import NetworkExtension
import Photos
import UIKit

@objc(GrNetPlugin)
public class GrNetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GrNetPlugin"
    public let jsName = "GrNet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bindToWifi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unbindWifi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWifiStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinWifi", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    private static let formContentType = "application/x-www-form-urlencoded; charset=UTF-8"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config)
    }()

    private let pathMonitor = NWPathMonitor()
    private var currentPath: Network.NWPath?

    override public func load() {
        pathMonitor.pathUpdateHandler = { [weak self] path in self?.currentPath = path }
        pathMonitor.start(queue: DispatchQueue(label: "grnet.path"))
    }

    deinit { pathMonitor.cancel() }

    // MARK: - HTTP

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("url is required")
            return
        }
        let timeoutMs = call.getInt("timeoutMs") ?? 10000

        var req = URLRequest(url: url)
        req.httpMethod = call.getString("method") ?? "GET"
        req.timeoutInterval = TimeInterval(timeoutMs) / 1000
        req.cachePolicy = .reloadIgnoringLocalCacheData

        var hasContentType = false
        for (key, value) in call.getObject("headers") ?? [:] {
            guard let v = value as? String else { continue }
            req.setValue(v, forHTTPHeaderField: key)
            if key.lowercased() == "content-type" { hasContentType = true }
        }
        if let body = call.getString("body") {
            // Exact bytes of the string — the camera needs "cmd=bdial P" / "xv=+0.7" unencoded.
            req.httpBody = body.data(using: .utf8)
            if !hasContentType { req.setValue(Self.formContentType, forHTTPHeaderField: "Content-Type") }
        }

        session.dataTask(with: req) { data, response, error in
            if let error = error {
                self.rejectNetwork(call, error, timeoutMs: timeoutMs)
                return
            }
            let http = response as? HTTPURLResponse
            var headers: JSObject = [:]
            for (k, v) in http?.allHeaderFields ?? [:] {
                if let k = k as? String { headers[k.lowercased()] = "\(v)" }
            }
            call.resolve([
                "status": http?.statusCode ?? 0,
                "data": String(data: data ?? Data(), encoding: .utf8) ?? "",
                "headers": headers
            ])
        }.resume()
    }

    // MARK: - Wi-Fi

    @objc func bindToWifi(_ call: CAPPluginCall) {
        // iOS routes traffic for the camera's on-link subnet over Wi-Fi already.
        call.resolve(wifiStatus())
    }

    @objc func unbindWifi(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func getWifiStatus(_ call: CAPPluginCall) {
        call.resolve(wifiStatus())
    }

    private func wifiStatus() -> JSObject {
        let wifi = currentPath?.availableInterfaces.contains { $0.type == .wifi } ?? false
        return ["platform": "ios", "bound": false, "wifiConnected": wifi]
    }

    @objc func joinWifi(_ call: CAPPluginCall) {
        guard let ssid = call.getString("ssid"), !ssid.isEmpty else {
            call.reject("ssid is required")
            return
        }
        let passphrase = call.getString("passphrase") ?? ""
        let config = passphrase.isEmpty
            ? NEHotspotConfiguration(ssid: ssid)
            : NEHotspotConfiguration(ssid: ssid, passphrase: passphrase, isWEP: false)
        config.joinOnce = false

        NEHotspotConfigurationManager.shared.apply(config) { error in
            if let error = error as NSError? {
                if error.domain == NEHotspotConfigurationErrorDomain,
                   error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    call.resolve(["joined": true])
                } else {
                    call.resolve(["joined": false, "message": error.localizedDescription])
                }
                return
            }
            call.resolve(["joined": true])
        }
    }

    // MARK: - Downloads

    @objc func download(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("url is required")
            return
        }
        let fileName = Self.safeName(call.getString("fileName") ?? "download")
        let toGallery = call.getBool("saveToGallery") ?? false
        let timeoutMs = call.getInt("timeoutMs") ?? 120000

        var req = URLRequest(url: url)
        req.timeoutInterval = TimeInterval(timeoutMs) / 1000

        session.downloadTask(with: req) { tmp, response, error in
            if let error = error {
                self.rejectNetwork(call, error, timeoutMs: timeoutMs)
                return
            }
            guard let tmp = tmp, (response as? HTTPURLResponse)?.statusCode == 200 else {
                call.reject("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)", "NETWORK")
                return
            }
            do {
                let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("gr-downloads", isDirectory: true)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let dest = dir.appendingPathComponent(fileName)
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.moveItem(at: tmp, to: dest)
                let bytes = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int) ?? 0

                var result: JSObject = ["path": dest.path, "bytes": bytes, "savedToGallery": false]
                guard toGallery else {
                    call.resolve(result)
                    return
                }
                self.saveToPhotos(dest) { ok, message in
                    result["savedToGallery"] = ok
                    if let message = message { result["galleryMessage"] = message }
                    call.resolve(result)
                }
            } catch {
                call.reject("Could not store file: \(error.localizedDescription)", "IO", error)
            }
        }.resume()
    }

    private func saveToPhotos(_ file: URL, done: @escaping (Bool, String?) -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                done(false, "Photos access not allowed")
                return
            }
            let ext = file.pathExtension.lowercased()
            let type: PHAssetResourceType = (ext == "mov" || ext == "mp4") ? .video : .photo
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: type, fileURL: file, options: nil)
            }, completionHandler: { ok, error in
                done(ok, ok ? nil : "Photos save failed: \(error?.localizedDescription ?? "unknown")")
            })
        }
    }

    // MARK: - Misc

    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    // MARK: - Helpers

    private func rejectNetwork(_ call: CAPPluginCall, _ error: Error, timeoutMs: Int) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorTimedOut {
            call.reject("Timed out after \(timeoutMs) ms", "TIMEOUT", error)
        } else {
            // With Local Network access denied, iOS fails these requests immediately.
            call.reject("\(ns.localizedDescription) (\(ns.domain) \(ns.code))", "NETWORK", error)
        }
    }

    private static func safeName(_ name: String) -> String {
        let base = (name as NSString).lastPathComponent
        let cleaned = base.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0) ? String($0) : "_" }.joined()
        return cleaned.isEmpty ? "download" : cleaned
    }
}
