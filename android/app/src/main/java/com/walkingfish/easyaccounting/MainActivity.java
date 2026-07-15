package com.walkingfish.easyaccounting;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        setTheme(R.style.AppTheme_NoActionBar); // 強制在 super.onCreate 前切換回正式主題
        registerPlugin(WidgetStoragePlugin.class); // 必須在 super.onCreate 之前呼叫以註冊插件
        super.onCreate(savedInstanceState);
    }
}
