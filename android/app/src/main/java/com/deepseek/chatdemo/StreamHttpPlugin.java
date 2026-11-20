package com.deepseek.chatdemo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CoderResult;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 流式 POST：原生发请求，逐块把响应正文回传给网页。
 *
 * 用途只有一个：第三方对话端点不允许跨域携带 x-api-key / Authorization / anthropic-version，
 * 浏览器的 CORS 预检会直接拒绝，导致请求根本发不出去。走原生网络栈不受 CORS 约束，
 * 同时保留 SSE 的增量到达，不牺牲打字效果。
 *
 * 协议：post() 立即 resolve；正文以 data 事件分块下发，结束时发 end，出错发 fail。
 */
@CapacitorPlugin(name = "StreamHttp")
public class StreamHttpPlugin extends Plugin {

    /** 合并窗口：每 30ms 或 8KB 回传一次，避免逐个 token 触发桥接开销。 */
    private static final long FLUSH_INTERVAL_MS = 30;
    private static final int FLUSH_BYTES = 8 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    /** 模型思考期间可能长时间没有输出，读超时要放宽。 */
    private static final int READ_TIMEOUT_MS = 300_000;

    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Set<String> aborted = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void post(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String body = call.getString("body", "");
        JSObject headers = call.getObject("headers");
        if (id == null || url == null) {
            call.reject("id and url are required");
            return;
        }
        // 先把调用结果交回网页，后续内容全部通过事件推送。
        call.resolve();
        if (headers == null) {
            headers = new JSObject();
        }
        JSObject finalHeaders = headers;
        new Thread(() -> run(id, url, body, finalHeaders), "stream-http").start();
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            aborted.add(id);
            HttpURLConnection connection = active.remove(id);
            if (connection != null) {
                connection.disconnect();
            }
        }
        call.resolve();
    }

    private void run(String id, String url, String body, JSObject headers) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            active.put(id, connection);
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            Iterator<String> names = headers.keys();
            while (names.hasNext()) {
                String name = names.next();
                // 长度由固定长度流模式决定，手动传会与实际字节数冲突。
                if (name == null || "content-length".equalsIgnoreCase(name)) {
                    continue;
                }
                String value = headers.getString(name, "");
                if (value != null) {
                    connection.setRequestProperty(name, value);
                }
            }
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(payload);
            }

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String detail = readAll(connection.getErrorStream());
                emitFail(id, status, detail.isEmpty() ? "HTTP " + status : detail);
                return;
            }
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.contains("text/event-stream")) {
                String detail = readAll(connection.getInputStream());
                emitFail(id, status, detail.isEmpty() ? "Response is not an event stream" : detail);
                return;
            }
            streamBody(id, connection.getInputStream());
            if (!aborted.contains(id)) {
                emitEnd(id);
            }
        } catch (Exception error) {
            if (!aborted.contains(id)) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                emitFail(id, 0, message);
            }
        } finally {
            active.remove(id);
            aborted.remove(id);
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /** 按 UTF-8 增量解码，跨读取边界被截断的多字节字符不会变成乱码。 */
    private void streamBody(String id, InputStream input) throws IOException {
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder();
        CharBuffer chars = CharBuffer.allocate(16 * 1024);
        StringBuilder pending = new StringBuilder();
        byte[] buffer = new byte[8 * 1024];
        long lastFlush = System.currentTimeMillis();
        int read;
        while ((read = input.read(buffer)) >= 0) {
            if (aborted.contains(id)) {
                return;
            }
            ByteBuffer bytes = ByteBuffer.wrap(buffer, 0, read);
            while (true) {
                CoderResult result = decoder.decode(bytes, chars, false);
                append(chars, pending);
                if (!result.isOverflow()) {
                    break;
                }
            }
            long now = System.currentTimeMillis();
            if (pending.length() >= FLUSH_BYTES || (pending.length() > 0 && now - lastFlush >= FLUSH_INTERVAL_MS)) {
                emitData(id, pending);
                lastFlush = now;
            }
        }
        ByteBuffer tail = ByteBuffer.allocate(0);
        while (true) {
            CoderResult result = decoder.decode(tail, chars, true);
            append(chars, pending);
            if (!result.isOverflow()) {
                break;
            }
        }
        while (true) {
            CoderResult result = decoder.flush(chars);
            append(chars, pending);
            if (!result.isOverflow()) {
                break;
            }
        }
        if (pending.length() > 0) {
            emitData(id, pending);
        }
    }

    private static void append(CharBuffer chars, StringBuilder target) {
        chars.flip();
        if (chars.hasRemaining()) {
            target.append(chars);
        }
        chars.clear();
    }

    private static String readAll(InputStream input) {
        if (input == null) {
            return "";
        }
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (InputStream stream = input) {
            byte[] chunk = new byte[4096];
            int read;
            while ((read = stream.read(chunk)) >= 0) {
                buffer.write(chunk, 0, read);
            }
        } catch (IOException ignored) {
            // 只用于错误文案，读不全时返回已读部分。
        }
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8).trim();
    }

    private void emitData(String id, StringBuilder pending) {
        String text = pending.toString();
        pending.setLength(0);
        JSObject payload = new JSObject();
        payload.put("id", id);
        payload.put("text", text);
        emit("data", payload);
    }

    private void emitEnd(String id) {
        JSObject payload = new JSObject();
        payload.put("id", id);
        emit("end", payload);
    }

    private void emitFail(String id, int status, String message) {
        JSObject payload = new JSObject();
        payload.put("id", id);
        payload.put("status", status);
        payload.put("message", message == null ? "" : message);
        emit("fail", payload);
    }

    private void emit(String event, JSObject payload) {
        if (getActivity() == null) {
            return;
        }
        getActivity().runOnUiThread(() -> notifyListeners(event, payload));
    }
}
