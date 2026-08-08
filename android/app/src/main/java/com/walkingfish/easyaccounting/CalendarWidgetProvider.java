package com.walkingfish.easyaccounting;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.widget.RemoteViews;

/**
 * 行事曆金流檢視 Widget — 在桌面顯示當月月曆，有交易的日子標示顏點。
 *
 * Layout: calendar_widget_layout.xml (7x5 網格 + 月份標題 + 月總結)
 * Data:   SharedPreferences (via WidgetStoragePlugin)
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    private static final String PREF_NAME = "WidgetData";
    // daysData 格式: "1,0,0|2,1,0|3,0,1|...|31,0,0"
    // 每筆: dayNumber, hasIncome(0/1), hasExpense(0/1)
    private static final String KEY_CALENDAR_DAYS = "calendar_days";
    private static final String KEY_CALENDAR_MONTH_LABEL = "calendar_month_label";
    private static final String KEY_CALENDAR_TODAY = "calendar_today";
    private static final String KEY_CALENDAR_WEEKDAY_START = "calendar_weekday_start"; // 0=Sun, 6=Sat
    // 月總結
    private static final String KEY_CALENDAR_INCOME = "cal_income";
    private static final String KEY_CALENDAR_EXPENSE = "cal_expense";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences pref = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        String monthLabel = pref.getString(KEY_CALENDAR_MONTH_LABEL, "");
        String todayStr = pref.getString(KEY_CALENDAR_TODAY, "");
        String daysData = pref.getString(KEY_CALENDAR_DAYS, "");
        int weekdayStart = pref.getInt(KEY_CALENDAR_WEEKDAY_START, 0);

        // 月總結 (從主 widget 共用欄位)
        String monthBalance = pref.getString("month_balance", "$0");
        String budgetProgressText = pref.getString("budget_progress_text", "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.calendar_widget_layout);

        // 月份標題
        views.setTextViewText(R.id.cal_widget_month, monthLabel);

        // 月總結行
        // 從 daysData 統計收入/支出天數
        int incomeDays = 0;
        int expenseDays = 0;
        if (daysData != null && !daysData.isEmpty()) {
            String[] entries = daysData.split("\\|");
            for (String entry : entries) {
                String[] parts = entry.split(",");
                if (parts.length >= 3) {
                    try {
                        if (Integer.parseInt(parts[1].trim()) == 1) incomeDays++;
                        if (Integer.parseInt(parts[2].trim()) == 1) expenseDays++;
                    } catch (NumberFormatException ignored) {}
                }
            }
        }
        int calIncomeId = getResourceId(context, "cal_widget_income");
        int calExpenseId = getResourceId(context, "cal_widget_expense");
        int calBalanceId = getResourceId(context, "cal_widget_balance");
        views.setTextViewText(calIncomeId, "💰 " + incomeDays + " 天");
        views.setTextViewText(calExpenseId, "🛒 " + expenseDays + " 天");
        views.setTextViewText(calBalanceId, "結餘 " + monthBalance);

        // 預設 42 個格子全部空白
        for (int i = 0; i < 42; i++) {
            int dayId = getResourceId(context, "cal_day_" + String.format("%02d", i));
            views.setTextViewText(dayId, "");
            views.setTextColor(dayId, Color.parseColor("#9CA3AF"));
        }

        // 解析 daysData 並填補網格
        // weekdayStart = 本月第 1 天的星期 (0=Sun ... 6=Sat)
        // 格子 offset = weekdayStart (因為 layout 是 日 一 二 三 四 五 六)
        int gridOffset = weekdayStart;

        if (daysData != null && !daysData.isEmpty()) {
            String[] entries = daysData.split("\\|");
            for (String entry : entries) {
                String[] parts = entry.split(",");
                if (parts.length >= 3) {
                    try {
                        int dayNum = Integer.parseInt(parts[0].trim());
                        int hasIncome = Integer.parseInt(parts[1].trim());
                        int hasExpense = Integer.parseInt(parts[2].trim());

                        // 格子位置 = offset + (dayNum - 1)
                        int idx = gridOffset + (dayNum - 1);
                        if (idx >= 0 && idx < 42) {
                            int dayId = getResourceId(context, "cal_day_" + String.format("%02d", idx));

                            // 日期數字
                            String displayText = String.valueOf(dayNum);

                            // 今天高亮
                            boolean isToday = String.valueOf(dayNum).equals(todayStr);

                            // 交易標記
                            if (hasIncome == 1 && hasExpense == 1) {
                                displayText += " ●●";
                            } else if (hasIncome == 1) {
                                displayText += " ●";
                            } else if (hasExpense == 1) {
                                displayText += " ●";
                            }

                            views.setTextViewText(dayId, displayText);

                            if (isToday) {
                                // 今天: 藍色粗體
                                views.setTextColor(dayId, Color.parseColor("#3B82F6"));
                            } else if (hasIncome == 1 && hasExpense == 0) {
                                // 只有收入: 綠色
                                views.setTextColor(dayId, Color.parseColor("#A5D6A7"));
                            } else if (hasExpense == 1 && hasIncome == 0) {
                                // 只有支出: 紅色
                                views.setTextColor(dayId, Color.parseColor("#EF9A9A"));
                            } else if (hasIncome == 1 && hasExpense == 1) {
                                // 雙色: 黃色
                                views.setTextColor(dayId, Color.parseColor("#FFE082"));
                            } else {
                                // 無交易: 一般灰色
                                views.setTextColor(dayId, Color.parseColor("#6B7280"));
                            }
                        }
                    } catch (NumberFormatException e) {
                        // 跳過無效的 entry
                    }
                }
            }
        }

        // 點擊 Widget 開啟 App 並跳到統計頁
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("easyaccounting://app/stats"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.cal_widget_grid, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private int getResourceId(Context context, String name) {
        return context.getResources().getIdentifier(
            name, "id", context.getPackageName()
        );
    }

    // 供 Plugin 調用，觸發立即更新
    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
            new ComponentName(context, CalendarWidgetProvider.class)
        );
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}