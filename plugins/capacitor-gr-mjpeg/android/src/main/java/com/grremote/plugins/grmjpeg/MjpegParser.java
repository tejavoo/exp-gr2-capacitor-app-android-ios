package com.grremote.plugins.grmjpeg;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

/**
 * Incremental MJPEG frame splitter (same algorithm as the web app's liveStream.ts).
 *
 * Feed it network chunks; it emits complete JPEGs. Uses the multipart part's Content-Length
 * when the headers directly precede the JPEG (robust against embedded EXIF thumbnails, which
 * contain their own FFD9), otherwise cuts on SOI (FFD8) … EOI (FFD9).
 * Not thread-safe — use from the network thread only.
 */
final class MjpegParser {

    interface FrameSink {
        /** The array is owned by the receiver. */
        void onFrame(byte[] jpeg);
    }

    static final int MAX_FRAME = 4 * 1024 * 1024;
    private static final int HEADER_WINDOW = 256;

    private byte[] buf = new byte[256 * 1024];
    private int len = 0;
    private int start = -1;
    private int scanFrom = 0;

    void reset() {
        len = 0;
        start = -1;
        scanFrom = 0;
    }

    void feed(byte[] chunk, int n, FrameSink sink) {
        if (n <= 0) return;
        ensureCapacity(len + n);
        System.arraycopy(chunk, 0, buf, len, n);
        len += n;

        int consumed = 0;
        while (true) {
            if (start < 0) {
                start = find(0xD8, Math.max(consumed, scanFrom));
                if (start < 0) {
                    // Keep a tail: FF D8 may straddle chunks, and the part headers (Content-Length)
                    // that precede the next JPEG must survive until it arrives.
                    consumed = Math.max(consumed, len - HEADER_WINDOW);
                    scanFrom = Math.max(consumed, len - 1);
                    break;
                }
            }

            int declared = partLength(start);
            if (declared > 0) {
                if (len < start + declared) break;
                sink.onFrame(Arrays.copyOfRange(buf, start, start + declared));
                consumed = start + declared;
                start = -1;
                scanFrom = consumed;
                continue;
            }

            int end = find(0xD9, Math.max(start + 2, scanFrom));
            if (end < 0) {
                scanFrom = Math.max(start + 2, len - 1);
                if (len - start > MAX_FRAME) { // garbage — resync
                    consumed = len;
                    start = -1;
                    scanFrom = len;
                }
                break;
            }
            sink.onFrame(Arrays.copyOfRange(buf, start, end + 2));
            consumed = end + 2;
            start = -1;
            scanFrom = consumed;
        }
        compact(consumed);
    }

    private void compact(int consumed) {
        if (consumed <= 0) return;
        int remain = len - consumed;
        if (remain > 0) System.arraycopy(buf, consumed, buf, 0, remain);
        len = Math.max(remain, 0);
        if (start >= 0) start -= consumed;
        scanFrom = Math.max(0, scanFrom - consumed);
    }

    private int find(int second, int from) {
        for (int i = Math.max(0, from); i < len - 1; i++) {
            if ((buf[i] & 0xFF) == 0xFF && (buf[i + 1] & 0xFF) == second) return i;
        }
        return -1;
    }

    /** Content-Length from part headers that end ("\r\n\r\n") exactly where the JPEG starts. */
    private int partLength(int jpegStart) {
        if (jpegStart < 16) return 0;
        int from = Math.max(0, jpegStart - HEADER_WINDOW);
        String head = new String(buf, from, jpegStart - from, StandardCharsets.ISO_8859_1);
        int blank = head.lastIndexOf("\r\n\r\n");
        if (blank < 0 || head.length() - blank != 4) return 0;
        int boundary = Math.max(0, head.lastIndexOf("--"));
        String lower = head.substring(boundary).toLowerCase(Locale.ROOT);
        int k = lower.indexOf("content-length:");
        if (k < 0) return 0;
        int i = k + "content-length:".length();
        while (i < lower.length() && lower.charAt(i) == ' ') i++;
        int j = i;
        while (j < lower.length() && Character.isDigit(lower.charAt(j))) j++;
        if (j == i) return 0;
        try {
            int v = Integer.parseInt(lower.substring(i, j));
            return v > 0 && v < MAX_FRAME ? v : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void ensureCapacity(int need) {
        if (need <= buf.length) return;
        int cap = buf.length;
        while (cap < need) cap *= 2;
        buf = Arrays.copyOf(buf, Math.min(cap, MAX_FRAME * 2));
        if (buf.length < need) { // pathological input: drop and resync
            reset();
            buf = new byte[256 * 1024];
        }
    }
}
