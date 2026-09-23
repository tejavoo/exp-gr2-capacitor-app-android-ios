package com.grremote.plugins.grmjpeg;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.widget.ImageView;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * network thread ──► newest-JPEG slot ──► decode thread ──► newest-Bitmap slot ──► UI thread
 *
 * Every slot holds only the newest item; older ones are dropped, so the picture never lags.
 * Bitmaps are reused (inBitmap) and only recycled into the pool two frames after they left
 * the screen, so there is no allocation churn and no tearing.
 */
final class MjpegStreamer implements Runnable {

    interface Listener {
        void onState(String state, String message);
        void onStats(int fps, int dropped, int width, int height, String contentType, String mode);
    }

    private static final int CHUNK = 32 * 1024;
    private static final int POOL_MAX = 3;

    private final Object lock = new Object();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final HandlerThread decodeThread = new HandlerThread("mjpeg-decode");
    private final Handler decoder;
    private final Listener listener;
    private final Map<String, String> headers;
    private final int stallMs;
    private final ImageView view;

    private volatile String url;
    private volatile boolean running = true;
    private volatile boolean paused = false;
    private volatile HttpURLConnection currentConn;
    private volatile boolean framesMode = false;
    private volatile String contentType = "";
    private Thread thread;

    private final AtomicReference<byte[]> latestJpeg = new AtomicReference<>();
    private final AtomicBoolean decodeScheduled = new AtomicBoolean(false);
    private final AtomicReference<Bitmap> pendingBitmap = new AtomicReference<>();
    private final AtomicBoolean uiScheduled = new AtomicBoolean(false);
    private final ConcurrentLinkedQueue<Bitmap> pool = new ConcurrentLinkedQueue<>();

    // UI-thread only
    private Bitmap displayed;
    private Bitmap previous;
    private int drawn = 0;

    private volatile int dropped = 0;
    private volatile int width = 0;
    private volatile int height = 0;
    private int framesThisResponse = 0;

    MjpegStreamer(String url, Map<String, String> headers, int stallMs, ImageView view, Listener listener) {
        this.url = url;
        this.headers = headers;
        this.stallMs = stallMs;
        this.view = view;
        this.listener = listener;
        decodeThread.start();
        decoder = new Handler(decodeThread.getLooper());
    }

    void start() {
        thread = new Thread(this, "mjpeg-net");
        thread.start();
        main.postDelayed(statsTask, 1000);
    }

    void stop() {
        running = false;
        synchronized (lock) { lock.notifyAll(); }
        closeConnection();
        if (thread != null) thread.interrupt();
        main.removeCallbacks(statsTask);
        main.removeCallbacks(uiTask);
        decodeThread.quitSafely();
        pool.clear();
        emitState("stopped", null);
    }

    void pause() {
        paused = true;
        closeConnection();
        emitState("paused", null);
    }

    void resume() {
        if (!paused) return;
        paused = false;
        synchronized (lock) { lock.notifyAll(); }
    }

    void setUrl(String newUrl) {
        url = newUrl;
        framesMode = false;
        closeConnection(); // the loop reconnects to the new URL
    }

    // ───────────── network thread ─────────────

    @Override
    public void run() {
        int failures = 0;
        emitState("connecting", null);
        while (running) {
            if (paused) {
                synchronized (lock) {
                    while (paused && running) {
                        try { lock.wait(); } catch (InterruptedException ignored) { }
                    }
                }
                if (!running) break;
                emitState(framesMode ? "frames" : "connecting", null);
            }

            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(stallMs); // doubles as the stall watchdog
                conn.setUseCaches(false);
                for (Map.Entry<String, String> h : headers.entrySet()) conn.setRequestProperty(h.getKey(), h.getValue());
                currentConn = conn;

                int code = conn.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code);
                String ct = conn.getContentType();
                contentType = ct != null ? ct : "";

                MjpegParser parser = new MjpegParser();
                framesThisResponse = 0;
                byte[] chunk = new byte[CHUNK];
                try (InputStream in = conn.getInputStream()) {
                    int n;
                    while (running && !paused && (n = in.read(chunk)) != -1) {
                        parser.feed(chunk, n, this::onFrame);
                    }
                }
                failures = 0;
                if (!running || paused) continue;

                if (!framesMode && framesThisResponse <= 1) {
                    framesMode = true; // camera answers one JPEG per request: chain requests
                    emitState("frames", "Camera sends single images; chaining requests");
                } else if (!framesMode) {
                    sleep(250); // stream ended cleanly — reopen
                }
            } catch (SocketTimeoutException e) {
                if (!running || paused) continue;
                emitState("stalled", "No frame for " + stallMs + " ms — reconnecting");
                sleep(300);
            } catch (Exception e) {
                if (!running || paused) continue;
                failures++;
                long wait = Math.min(500L << Math.min(failures, 4), 5000L);
                emitState("error", e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "")
                    + " — retry in " + wait + " ms");
                sleep(wait);
            } finally {
                currentConn = null;
                if (conn != null) conn.disconnect();
            }
        }
    }

    private void onFrame(byte[] jpeg) {
        framesThisResponse++;
        if (framesThisResponse == 1 && !framesMode) emitState("streaming", null);
        if (latestJpeg.getAndSet(jpeg) != null) dropped++;
        if (decodeScheduled.compareAndSet(false, true)) decoder.post(decodeTask);
    }

    // ───────────── decode thread ─────────────

    private final Runnable decodeTask = this::decodeLatest;
    private final Runnable uiTask = this::drawPending;
    private final Runnable statsTask = this::emitStats;

    private void decodeLatest() {
        decodeScheduled.set(false);
        byte[] jpeg = latestJpeg.getAndSet(null);
        if (jpeg == null || !running) return;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inMutable = true;
        Bitmap reuse = pool.poll();
        opts.inBitmap = reuse;
        Bitmap bmp;
        try {
            bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opts);
        } catch (IllegalArgumentException sizeMismatch) {
            if (reuse != null) reuse.recycle();
            reuse = null;
            opts.inBitmap = null;
            bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opts);
        }
        if (bmp == null) {
            if (reuse != null) release(reuse);
            return;
        }
        if (reuse != null && reuse != bmp) release(reuse);
        width = bmp.getWidth();
        height = bmp.getHeight();

        Bitmap stale = pendingBitmap.getAndSet(bmp);
        if (stale != null) {
            dropped++;
            release(stale);
        }
        if (uiScheduled.compareAndSet(false, true)) main.post(uiTask);
    }

    // ───────────── UI thread ─────────────

    private void drawPending() {
        uiScheduled.set(false);
        Bitmap bmp = pendingBitmap.getAndSet(null);
        if (bmp == null || !running) return;
        view.setImageBitmap(bmp);
        Bitmap retired = previous; // left the screen two frames ago — safe to reuse
        previous = displayed;
        displayed = bmp;
        if (retired != null) release(retired);
        drawn++;
    }

    private void emitStats() {
        if (!running) return;
        int fps = drawn;
        drawn = 0;
        int d = dropped;
        dropped = 0;
        listener.onStats(fps, d, width, height, contentType, framesMode ? "frames" : "stream");
        main.postDelayed(statsTask, 1000);
    }

    // ───────────── helpers ─────────────

    private void release(Bitmap b) {
        if (b == null || b.isRecycled()) return;
        if (pool.size() < POOL_MAX && running) pool.offer(b);
        else b.recycle();
    }

    private void closeConnection() {
        HttpURLConnection c = currentConn;
        if (c != null) {
            // Unblocks a read() in progress on the network thread.
            new Thread(c::disconnect, "mjpeg-close").start();
        }
    }

    private void sleep(long ms) {
        synchronized (lock) {
            try { lock.wait(ms); } catch (InterruptedException ignored) { }
        }
    }

    private void emitState(String state, String message) {
        main.post(() -> listener.onState(state, message));
    }
}
