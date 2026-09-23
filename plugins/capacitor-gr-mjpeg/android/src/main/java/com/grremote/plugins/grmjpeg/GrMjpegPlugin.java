package com.grremote.plugins.grmjpeg;

import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Native MJPEG viewer drawn UNDER a transparent WebView, so HTML overlays (HUD, tap-to-focus)
 * stay on top and interactive. Frames never cross the JS bridge.
 */
@CapacitorPlugin(name = "GrMjpeg")
public class GrMjpegPlugin extends Plugin {

    private FrameLayout container;
    private ImageView imageView;
    private MjpegStreamer streamer;
    private boolean pausedByJs = false;

    @PluginMethod
    public void start(PluginCall call) {
        final String url = call.getString("url");
        final JSObject rect = call.getObject("rect");
        if (url == null || rect == null) {
            call.reject("url and rect are required");
            return;
        }
        final int stallMs = call.getInt("stallTimeoutMs", 4000);
        final int bg = parseColor(call.getString("backgroundColor", "#000000"));
        final Map<String, String> headers = toMap(call.getObject("headers", new JSObject()));

        getBridge().executeOnMainThread(() -> {
            teardown();
            WebView webView = getBridge().getWebView();
            ViewGroup parent = (ViewGroup) webView.getParent();

            container = new FrameLayout(getContext());
            container.setBackgroundColor(bg);
            container.setClickable(false);
            container.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            parent.addView(container, parent.indexOfChild(webView),
                new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            imageView = new ImageView(getContext());
            imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
            imageView.setBackgroundColor(Color.BLACK);
            container.addView(imageView, new FrameLayout.LayoutParams(0, 0));
            applyRect(rect);

            // Let the native view show through the page.
            webView.setBackgroundColor(Color.TRANSPARENT);

            pausedByJs = false;
            streamer = new MjpegStreamer(url, headers, stallMs, imageView, new MjpegStreamer.Listener() {
                @Override
                public void onState(String state, String message) {
                    JSObject e = new JSObject();
                    e.put("state", state);
                    if (message != null) e.put("message", message);
                    notifyListeners("state", e);
                }

                @Override
                public void onStats(int fps, int dropped, int width, int height, String contentType, String mode) {
                    JSObject e = new JSObject();
                    e.put("fps", fps);
                    e.put("dropped", dropped);
                    e.put("width", width);
                    e.put("height", height);
                    e.put("contentType", contentType);
                    e.put("mode", mode);
                    notifyListeners("stats", e);
                }
            });
            streamer.start();
            call.resolve();
        });
    }

    @PluginMethod
    public void setRect(PluginCall call) {
        final JSObject rect = call.getData();
        getBridge().executeOnMainThread(() -> {
            applyRect(rect);
            call.resolve();
        });
    }

    @PluginMethod
    public void setUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url is required");
            return;
        }
        if (streamer != null) streamer.setUrl(url);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        pausedByJs = true;
        if (streamer != null) streamer.pause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        pausedByJs = false;
        if (streamer != null) streamer.resume();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            teardown();
            call.resolve();
        });
    }

    // App lifecycle: never stream in the background.
    @Override
    protected void handleOnPause() {
        if (streamer != null) streamer.pause();
    }

    @Override
    protected void handleOnResume() {
        if (streamer != null && !pausedByJs) streamer.resume();
    }

    @Override
    protected void handleOnDestroy() {
        if (streamer != null) streamer.stop();
        streamer = null;
    }

    // ───────────── helpers ─────────────

    /** CSS px (relative to the WebView viewport) → device px in the container. */
    private void applyRect(JSObject rect) {
        if (imageView == null || rect == null) return;
        WebView webView = getBridge().getWebView();
        float d = getContext().getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            Math.max(0, Math.round((float) rect.optDouble("width", 0) * d)),
            Math.max(0, Math.round((float) rect.optDouble("height", 0) * d)));
        lp.leftMargin = webView.getLeft() + Math.round((float) rect.optDouble("x", 0) * d);
        lp.topMargin = webView.getTop() + Math.round((float) rect.optDouble("y", 0) * d);
        imageView.setLayoutParams(lp);
    }

    private void teardown() {
        if (streamer != null) {
            streamer.stop();
            streamer = null;
        }
        if (container != null) {
            ViewGroup parent = (ViewGroup) container.getParent();
            if (parent != null) parent.removeView(container);
            container = null;
            imageView = null;
        }
    }

    private static Map<String, String> toMap(JSObject obj) {
        Map<String, String> map = new HashMap<>();
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            String v = obj.optString(k, null);
            if (v != null) map.put(k, v);
        }
        return map;
    }

    private static int parseColor(String hex) {
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return Color.BLACK;
        }
    }
}
