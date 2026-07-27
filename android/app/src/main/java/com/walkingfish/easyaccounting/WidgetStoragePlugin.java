package com.walkingfish.easyaccounting;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetStorage")
public class WidgetStoragePlugin extends Plugin {
    private static final String TAG = "WidgetStorage";

    @PluginMethod
    public void updateWidgetData(PluginCall call) {
        try {
            // 直接從 call 取得攤平的欄位 (不再使用巢狀 getObject)
            String todayExpense = call.getString("todayExpense", "$0");
            String monthBalance = call.getString("monthBalance", "$0");
            String budgetProgressText = call.getString("budgetProgressText", "0%");
            Integer budgetProgressVal = call.getInt("budgetProgressVal", 0);
            String categoryBudgetStatus = call.getString("categoryBudgetStatus", "");

            String carrierCode = call.getString("carrierCode", "");

            String calendarDays = call.getString("calendarDays", "");
            String calendarMonthLabel = call.getString("calendarMonthLabel", "");
            String calendarToday = call.getString("calendarToday", "");
            int calendarWeekdayStart = call.getInt("calendarWeekdayStart", 1);

            Log.d(TAG, "Received: todayExpense=" + todayExpense
                    + ", monthBalance=" + monthBalance
                    + ", budgetProgressText=" + budgetProgressText
                    + ", budgetProgressVal=" + budgetProgressVal
                    + ", categoryBudgetStatus=" + categoryBudgetStatus
                    + ", carrierCode=" + carrierCode
                    + ", calendarDays=" + (calendarDays != null ? calendarDays.substring(0, Math.min(50, calendarDays.length())) : "null"));

            SharedPreferences sharedPref = getContext().getSharedPreferences("WidgetData", Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = sharedPref.edit();
            editor.putString("today_expense", todayExpense);
            editor.putString("month_balance", monthBalance);
            editor.putString("budget_progress_text", budgetProgressText);
            editor.putInt("budget_progress_val", budgetProgressVal != null ? budgetProgressVal : 0);
            editor.putString("category_budget_status", categoryBudgetStatus);
            editor.putString("carrier_code", carrierCode);
            // Calendar widget data (only update if provided)
            if (call.hasOption("calendarDays")) {
                editor.putString("calendar_days", call.getString("calendarDays", ""));
                editor.putString("calendar_month_label", call.getString("calendarMonthLabel", ""));
                editor.putString("calendar_today", call.getString("calendarToday", ""));
                editor.putInt("calendar_weekday_start", call.getInt("calendarWeekdayStart", 1));
            }
            editor.apply();

            // 觸發所有 Widget 立即刷新
            EasyAccountingWidgetProvider.triggerUpdate(getContext());
            InvoiceCarrierWidgetProvider.triggerUpdate(getContext());
            QuickCategoryWidgetProvider.triggerUpdate(getContext());
            CalendarWidgetProvider.triggerUpdate(getContext());

            Log.d(TAG, "All widgets data saved and update triggered.");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to update widget data", e);
            call.reject("Failed to update widget data: " + e.getMessage());
        }
    }
}
