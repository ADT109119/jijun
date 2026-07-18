package com.walkingfish.easyaccounting;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;
import android.graphics.Color;

public class EasyAccountingWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences sharedPref = context.getSharedPreferences("WidgetData", Context.MODE_PRIVATE);
        String todayExpense = sharedPref.getString("today_expense", "$0");
        String monthBalance = sharedPref.getString("month_balance", "$0");
        String budgetProgressText = sharedPref.getString("budget_progress_text", "0%");
        int budgetProgressVal = sharedPref.getInt("budget_progress_val", 0);
        String categoryBudgetStatus = sharedPref.getString("category_budget_status", "");

        // 綁定 Layout XML
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);
        views.setTextViewText(R.id.widget_today_expense, todayExpense);
        views.setTextViewText(R.id.widget_month_balance, monthBalance);
        views.setTextViewText(R.id.widget_budget_progress, budgetProgressText);
        views.setProgressBar(R.id.widget_progress_bar, 100, budgetProgressVal, false);

        // 分類預算狀態 (最多 3 行)
        int[] catIds = {R.id.widget_cat_budget_1, R.id.widget_cat_budget_2, R.id.widget_cat_budget_3};
        if (categoryBudgetStatus == null || categoryBudgetStatus.trim().isEmpty()) {
            for (int id : catIds) {
                views.setViewVisibility(id, android.view.View.GONE);
            }
        } else {
            String[] lines = categoryBudgetStatus.split("\n", 3);
            boolean hasOverBudget = categoryBudgetStatus.contains("超支") || categoryBudgetStatus.contains("⚠️");
            int textColor = hasOverBudget ? Color.parseColor("#FFEF9A9A") : Color.parseColor("#80FFFFFF");
            for (int i = 0; i < catIds.length; i++) {
                if (i < lines.length && !lines[i].trim().isEmpty()) {
                    views.setViewVisibility(catIds[i], android.view.View.VISIBLE);
                    views.setTextViewText(catIds[i], lines[i].trim());
                    views.setTextColor(catIds[i], textColor);
                } else {
                    views.setViewVisibility(catIds[i], android.view.View.GONE);
                }
            }
        }

        // 設定快速記帳快捷鍵 (帶入 action=quick_add 參數)
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("easyaccounting://home?widget_action=quick_add"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context, 
            0, 
            intent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_btn_quick_add, pendingIntent);

        // 更新 Widget
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    // 靜態方法：供 Plugin 調用，通知系統立即更新所有 Widget
    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(context, EasyAccountingWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
            new ComponentName(context, EasyAccountingWidgetProvider.class)
        );
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
