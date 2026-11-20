package com.deepseek.chatdemo;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新：原生下载安装包并交给系统安装器。
 *
 * 由原生完成下载有两个原因：Release 资产会重定向到另一个域名，网页端会被跨域拦住；
 * 另外安装必须由原生发起。
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String APK_NAME = "yanban-update.apk";
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 300_000;

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        Context context = getContext();
        if (url == null || url.isEmpty() || context == null) {
            call.reject("url is required");
            return;
        }
        new Thread(() -> {
            try {
                File apk = download(context, url);
                // 系统要求用户显式允许本应用安装未知来源的应用，缺失时直接跳过去开。
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !context.getPackageManager().canRequestPackageInstalls()) {
                    openUnknownSourcesSettings(context);
                    call.reject("allow_unknown_sources", "UNKNOWN_SOURCES");
                    return;
                }
                install(context, apk);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? error.toString() : error.getMessage());
            }
        }, "app-updater").start();
    }

    /** 下载到缓存目录；同名文件直接覆盖，避免多次更新堆积。下载中按百分比通知界面。 */
    private File download(Context context, String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/octet-stream");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IOException("下载失败：HTTP " + status);
            }
            // 资产会重定向到 CDN，长度以最终响应为准；拿不到长度时界面保持不确定态
            long total = connection.getContentLengthLong();
            File target = new File(context.getCacheDir(), APK_NAME);
            long downloaded = 0;
            int lastPercent = -1;
            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        int percent = (int) Math.min(100, downloaded * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            emitProgress(percent);
                        }
                    }
                }
            }
            if (target.length() == 0) {
                throw new IOException("下载的安装包为空");
            }
            if (lastPercent >= 0) {
                emitProgress(100);
            }
            return target;
        } finally {
            connection.disconnect();
        }
    }

    /** 把下载进度推给网页端，界面据此把按钮换成百分比进度条 */
    private void emitProgress(int percent) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        // 下载在后台线程，事件回调切回主线程，避免直接碰 WebView
        getBridge().executeOnMainThread(() -> notifyListeners("progress", data));
    }

    /** 通过 FileProvider 暴露缓存文件，交给系统安装器。 */
    private void install(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private void openUnknownSourcesSettings(Context context) {
        Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
