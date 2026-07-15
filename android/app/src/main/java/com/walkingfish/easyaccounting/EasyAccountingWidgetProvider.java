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

        if (categoryBudgetStatus == null || categoryBudgetStatus.trim().isEmpty()) {
            views.setViewVisibility(R.id.widget_category_budget_status, android.view.View.GONE);
        } else {
            views.setViewVisibility(R.id.widget_category_budget_status, android.view.View.VISIBLE);
            views.setTextViewText(R.id.widget_category_budget_status, categoryBudgetStatus);
            if (categoryBudgetStatus.contains("超支") || categoryBudgetStatus.contains("⚠️")) {
                views.setTextColor(R.id.widget_category_budget_status, Color.parseColor("#FFEF9A9A"));
            } else {
                views.setTextColor(R.id.widget_category_budget_status, Color.parseColor("#80FFFFFF"));
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
