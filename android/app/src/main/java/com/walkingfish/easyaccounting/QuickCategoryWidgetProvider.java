package com.walkingfish.easyaccounting;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

public class QuickCategoryWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.shortcut_widget_layout);

        // 綁定「＋ 記一筆」按鈕 Deep Link
        views.setOnClickPendingIntent(R.id.widget_shortcut_btn_add, getPendingIntent(context, "", 10));

        // 綁定 5 個分類按鈕 Deep Link
        views.setOnClickPendingIntent(R.id.widget_shortcut_cat_food, getPendingIntent(context, "food", 1));
        views.setOnClickPendingIntent(R.id.widget_shortcut_cat_transport, getPendingIntent(context, "transport", 2));
        views.setOnClickPendingIntent(R.id.widget_shortcut_cat_entertainment, getPendingIntent(context, "entertainment", 3));
        views.setOnClickPendingIntent(R.id.widget_shortcut_cat_shopping, getPendingIntent(context, "shopping", 4));
        views.setOnClickPendingIntent(R.id.widget_shortcut_cat_daily, getPendingIntent(context, "daily", 5));

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private PendingIntent getPendingIntent(Context context, String category, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        
        String url = "easyaccounting://home?widget_action=quick_add";
        if (!category.isEmpty()) {
            url += "&category=" + category;
        }
        
        intent.setData(Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        return PendingIntent.getActivity(
            context, 
            requestCode, 
            intent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(context, QuickCategoryWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
            new ComponentName(context, QuickCategoryWidgetProvider.class)
        );
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
