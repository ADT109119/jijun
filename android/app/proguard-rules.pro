# Chart.js
-keep class org.knowm.xchart.** { *; }
-dontwarn org.knowm.xchart.**

# IndexedDB / IDB
-keep class idb.** { *; }

# Capacitor
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }

# AdMob
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.common.** { *; }

# Widget
-keep class com.walkingfish.easyaccounting.** { *; }

# JavaScript interface (WebView JS bridge)
-keepclassmembers class com.getcapacitor.BridgeActivity {
    <methods>;
}

# 保留所有 PluginMethod 註解的方法
-keepattributes RuntimeVisibleAnnotations
-keep @com.getcapacitor.PluginMethod * { *; }

# 保留 SourceFile 和 LineNumberTable 以便除錯
-keepattributes SourceFile,LineNumberTable
