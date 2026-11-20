package com.deepseek.chatdemo;

import android.content.Context;

import androidx.appcompat.app.AppCompatDelegate;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 让原生 Activity 的夜间模式跟随网页主题设置。
 * 系统长按文本时的选择菜单、放大镜等使用 Activity 主题，跟随后可避免深色界面弹出浅色浮层；
 * 网页选择「跟随系统」时传 system，避免覆盖真正的系统深浅色。
 * 选择同时持久化，供 MainActivity 在冷启动首帧前恢复，消除启动白屏。
 */
@CapacitorPlugin(name = "AppAppearance")
public class AppAppearancePlugin extends Plugin {

    @PluginMethod
    public void setNightMode(PluginCall call) {
        String mode = call.getString("mode", "system");
        Context context = getContext();
        if (context != null) {
            context.getSharedPreferences(MainActivity.APPEARANCE_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(MainActivity.NIGHT_MODE_KEY, mode)
                    .apply();
        }
        int nightMode = MainActivity.nightModeOf(mode);
        getActivity().runOnUiThread(() -> AppCompatDelegate.setDefaultNightMode(nightMode));
        call.resolve();
    }
}
