package com.grremote.plugins.grnet;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "GrNet")
public class GrNetPlugin extends Plugin {

    private static final String FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private ConnectivityManager cm;
    private volatile Network boundNetwork;
    private ConnectivityManager.NetworkCallback wifiCallback;
    private ConnectivityManager.NetworkCallback joinCallback;

    @Override
    public void load() {
        cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    // ───────────────────────────── HTTP ─────────────────────────────

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final String body = call.getString("body");
        final int timeout = call.getInt("timeoutMs", 10000);
        final JSObject headers = call.getObject("headers", new JSObject());
        if (url == null) {
            call.reject("url is required");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = open(url);
                conn.setRequestMethod(method);
                conn.setConnectTimeout(timeout);
                conn.setReadTimeout(timeout);
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(false);
                boolean hasContentType = applyHeaders(conn, headers);

                if (body != null) {
                    // Exact bytes of the string: the camera needs "cmd=bdial P" / "xv=+0.7" unencoded.
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    if (!hasContentType) conn.setRequestProperty("Content-Type", FORM_CONTENT_TYPE);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = conn.getOutputStream()) {
                        out.write(bytes);
                    }
                }

                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String data = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);

                JSObject resHeaders = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) {
                        resHeaders.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue().get(0));
                    }
                }

                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("data", data);
                ret.put("headers", resHeaders);
                call.resolve(ret);
            } catch (SocketTimeoutException e) {
                call.reject("Timed out after " + timeout + " ms", "TIMEOUT", e);
            } catch (Exception e) {
                call.reject(describe(e), "NETWORK", e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ───────────────────────────── Wi-Fi binding ─────────────────────────────

    @PluginMethod
    public void bindToWifi(PluginCall call) {
        Network wifi = findWifiNetwork();
        if (wifi != null) bind(wifi);

        if (wifiCallback == null) {
            // Track the Wi-Fi network: rebind after reconnects, release when it disappears.
            NetworkRequest req = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            wifiCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    bind(network);
                }

                @Override
                public void onLost(Network network) {
                    if (network.equals(boundNetwork)) {
                        cm.bindProcessToNetwork(null);
                        boundNetwork = null;
                    }
                }
            };
            try {
                cm.requestNetwork(req, wifiCallback);
            } catch (Exception e) {
                wifiCallback = null;
            }
        }
        call.resolve(status());
    }

    @PluginMethod
    public void unbindWifi(PluginCall call) {
        if (wifiCallback != null) {
            try { cm.unregisterNetworkCallback(wifiCallback); } catch (Exception ignored) { }
            wifiCallback = null;
        }
        if (joinCallback != null) {
            try { cm.unregisterNetworkCallback(joinCallback); } catch (Exception ignored) { }
            joinCallback = null;
        }
        cm.bindProcessToNetwork(null);
        boundNetwork = null;
        call.resolve();
    }

    @PluginMethod
    public void getWifiStatus(PluginCall call) {
        call.resolve(status());
    }

    // ───────────────────────────── Downloads ─────────────────────────────

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String fileName = safeName(call.getString("fileName", "download"));
        final boolean toGallery = call.getBoolean("saveToGallery", false);
        final int timeout = call.getInt("timeoutMs", 120000);
        if (url == null) {
            call.reject("url is required");
            return;
        }

        executor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getCacheDir(), "gr-downloads");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create cache folder");
                File file = new File(dir, fileName);

                conn = open(url);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(timeout);
                conn.setUseCaches(false);
                int status = conn.getResponseCode();
                if (status != 200) throw new Exception("HTTP " + status);

                long bytes = 0;
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        bytes += n;
                    }
                }

                JSObject ret = new JSObject();
                ret.put("path", file.getAbsolutePath());
                ret.put("bytes", bytes);
                ret.put("savedToGallery", false);

                if (toGallery) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        try {
                            saveToGallery(file, fileName);
                            ret.put("savedToGallery", true);
                        } catch (Exception e) {
                            ret.put("galleryMessage", "Gallery save failed: " + describe(e));
                        }
                    } else {
                        ret.put("galleryMessage", "Android 9 or older: kept in app storage only");
                    }
                }
                call.resolve(ret);
            } catch (SocketTimeoutException e) {
                call.reject("Download timed out", "TIMEOUT", e);
            } catch (Exception e) {
                call.reject(describe(e), "NETWORK", e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ───────────────────────────── Misc ─────────────────────────────

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void joinWifi(PluginCall call) {
        final String ssid = call.getString("ssid");
        final String passphrase = call.getString("passphrase");
        if (ssid == null || ssid.isEmpty()) {
            call.reject("ssid is required");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("joined", false);
            ret.put("message", "Android 9 or older: join the camera Wi-Fi in system Settings.");
            call.resolve(ret);
            return;
        }

        WifiNetworkSpecifier.Builder spec = new WifiNetworkSpecifier.Builder().setSsid(ssid);
        if (passphrase != null && !passphrase.isEmpty()) spec.setWpa2Passphrase(passphrase);
        NetworkRequest req = new NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .setNetworkSpecifier(spec.build())
            .build();

        if (joinCallback != null) {
            try { cm.unregisterNetworkCallback(joinCallback); } catch (Exception ignored) { }
        }
        final AtomicBoolean settled = new AtomicBoolean(false);
        joinCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                bind(network);
                if (settled.compareAndSet(false, true)) {
                    JSObject ret = new JSObject();
                    ret.put("joined", true);
                    call.resolve(ret);
                }
            }

            @Override
            public void onUnavailable() {
                if (settled.compareAndSet(false, true)) {
                    JSObject ret = new JSObject();
                    ret.put("joined", false);
                    ret.put("message", "Not joined — cancelled, wrong passphrase, or camera Wi-Fi not found.");
                    call.resolve(ret);
                }
            }

            @Override
            public void onLost(Network network) {
                if (network.equals(boundNetwork)) {
                    cm.bindProcessToNetwork(null);
                    boundNetwork = null;
                }
            }
        };
        try {
            // Keep the callback registered: unregistering drops the app-scoped connection.
            cm.requestNetwork(req, joinCallback, 60000);
        } catch (Exception e) {
            joinCallback = null;
            call.reject("Could not request Wi-Fi: " + describe(e));
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ───────────────────────────── Helpers ─────────────────────────────

    private HttpURLConnection open(String url) throws Exception {
        URL u = new URL(url);
        Network n = boundNetwork;
        return (HttpURLConnection) (n != null ? n.openConnection(u) : u.openConnection());
    }

    private boolean applyHeaders(HttpURLConnection conn, JSObject headers) {
        boolean hasContentType = false;
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            String v = headers.getString(k);
            if (v == null) continue;
            conn.setRequestProperty(k, v);
            if (k.equalsIgnoreCase("content-type")) hasContentType = true;
        }
        return hasContentType;
    }

    private void bind(Network network) {
        if (cm.bindProcessToNetwork(network)) boundNetwork = network;
    }

    @SuppressWarnings("deprecation")
    private Network findWifiNetwork() {
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(n);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return n;
        }
        return null;
    }

    private JSObject status() {
        Network wifi = findWifiNetwork();
        NetworkCapabilities caps = wifi != null ? cm.getNetworkCapabilities(wifi) : null;
        JSObject s = new JSObject();
        s.put("platform", "android");
        s.put("bound", boundNetwork != null && boundNetwork.equals(cm.getBoundNetworkForProcess()));
        s.put("wifiConnected", wifi != null);
        s.put("hasInternet", caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        return s;
    }

    private void saveToGallery(File file, String name) throws Exception {
        String lower = name.toLowerCase(Locale.ROOT);
        boolean video = lower.endsWith(".mov") || lower.endsWith(".mp4");
        String mime = lower.endsWith(".dng") ? "image/x-adobe-dng"
            : lower.endsWith(".mov") ? "video/quicktime"
            : lower.endsWith(".mp4") ? "video/mp4"
            : "image/jpeg";

        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = video
            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,
            (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/GR Remote");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = resolver.insert(collection, values);
        if (item == null) throw new Exception("MediaStore insert failed");
        try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) throw new Exception("Cannot open gallery output");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        } catch (Exception e) {
            resolver.delete(item, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, values, null, null);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static String safeName(String name) {
        String base = name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        return base.isEmpty() ? "download" : base;
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        return e.getClass().getSimpleName() + (m != null ? ": " + m : "");
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }
}
