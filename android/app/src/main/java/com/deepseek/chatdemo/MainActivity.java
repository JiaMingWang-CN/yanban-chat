package com.deepseek.chatdemo;

import android.content.SharedPreferences;
import android.os.Bundle;

import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** 与 AppAppearancePlugin 共用：页面选择的深浅色要持久化，冷启动第一帧才能用对底色。 */
    static final String APPEARANCE_PREFS = "app-appearance";
    static final String NIGHT_MODE_KEY = "night-mode";

    /** 把页面传来的偏好映射成 AppCompat 的模式值。 */
    static int nightModeOf(String mode) {
        if ("dark".equals(mode)) {
            return AppCompatDelegate.MODE_NIGHT_YES;
        }
        if ("light".equals(mode)) {
            return AppCompatDelegate.MODE_NIGHT_NO;
        }
        return AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 必须早于 super.onCreate：窗口背景要在主题解析前就确定深浅色，
        // 否则深色界面会先闪一帧浅色底。
        SharedPreferences prefs = getSharedPreferences(APPEARANCE_PREFS, MODE_PRIVATE);
        AppCompatDelegate.setDefaultNightMode(nightModeOf(prefs.getString(NIGHT_MODE_KEY, "system")));

        registerPlugin(AppAppearancePlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(StreamHttpPlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);

        // WebView 自身是白底，页面样式生效前会露出来；先刷成与窗口一致的底色。
        getBridge().getWebView()
                .setBackgroundColor(ContextCompat.getColor(this, R.color.window_background));
    }
}
