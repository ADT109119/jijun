package com.walkingfish.easyaccounting;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.widget.RemoteViews;
import android.util.Log;

public class InvoiceCarrierWidgetProvider extends AppWidgetProvider {
    private static final String TAG = "CarrierWidget";

    private static final String[] CHARACTERS = {
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
        "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
        "U", "V", "W", "X", "Y", "Z",
        "-", ".", " ", "$", "/", "+", "%", "*"
    };

    private static final String[] ENCODINGS = {
        "000110100", "100100001", "001100001", "101100000", "000110001", // 0-4
        "100110000", "001110000", "000100101", "100100100", "001100100", // 5-9
        "100001001", "001001001", "101001000", "000011001", "100011000", // A-E
        "001011000", "000001101", "100001100", "001001100", "000011100", // F-J
        "100000011", "001000011", "101000010", "000010011", "100010010", // K-O
        "001010010", "000000111", "100000110", "001000110", "000010110", // P-T
        "110000001", "011000001", "111000000", "010010001", "110010000", // U-Y
        "011010000", // Z
        "010000101", "110000100", "011000100", "010101000", "010100100", // -, ., [space], $, /
        "010010100", "000101010", "010001100"  // +, %, *
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences sharedPref = context.getSharedPreferences("WidgetData", Context.MODE_PRIVATE);
        String carrierCode = sharedPref.getString("carrier_code", "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.carrier_widget_layout);

        if (carrierCode.trim().isEmpty()) {
            views.setTextViewText(R.id.widget_barcode_text, "請在設定頁配置發票載具");
            views.setImageViewBitmap(R.id.widget_barcode_img, null);
        } else {
            views.setTextViewText(R.id.widget_barcode_text, carrierCode);
            // 繪製 Code 39 條碼
            Bitmap barcodeBmp = generateCode39(carrierCode);
            if (barcodeBmp != null) {
                views.setImageViewBitmap(R.id.widget_barcode_img, barcodeBmp);
            } else {
                views.setImageViewBitmap(R.id.widget_barcode_img, null);
                views.setTextViewText(R.id.widget_barcode_text, "載具格式不支援");
            }
        }

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /**
     * 簡易 Code 39 條碼生成器
     */
    private Bitmap generateCode39(String rawCode) {
        try {
            // Code 39 必須包含起訖符 *
            String code = "*" + rawCode.toUpperCase() + "*";
            int length = code.length();

            // 計算寬度
            // 每個字元有 9 個元素 (3 寬 6 窄)
            // 窄元素 = 2px，寬元素 = 6px (1:3 比例)
            // 每個字元寬度 = 3*6 + 6*2 = 30px
            // 字元與字元間隙 = 2px
            int narrowWidth = 2;
            int wideWidth = 6;
            int charGap = 2;
            
            int charWidth = (3 * wideWidth) + (6 * narrowWidth);
            int totalWidth = (length * charWidth) + ((length - 1) * charGap);
            int height = 80; // 條碼高度為 80px

            Bitmap bitmap = Bitmap.createBitmap(totalWidth, height, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(Color.WHITE); // 條碼背景必須為純白以供掃描

            Paint paint = new Paint();
            paint.setColor(Color.BLACK);
            paint.setStyle(Paint.Style.FILL);

            int currentX = 0;

            for (int i = 0; i < length; i++) {
                char c = code.charAt(i);
                String encoding = getEncoding(c);
                if (encoding == null) {
                    return null; // 不支援字元
                }

                // 繪製 9 個元素
                for (int element = 0; element < 9; element++) {
                    boolean isBar = (element % 2 == 0); // 偶數位為黑條，奇數位為白空
                    boolean isWide = (encoding.charAt(element) == '1');
                    int elementWidth = isWide ? wideWidth : narrowWidth;

                    if (isBar) {
                        canvas.drawRect(currentX, 0, currentX + elementWidth, height, paint);
                    }
                    currentX += elementWidth;
                }

                // 繪製字元間隙 (白空)
                currentX += charGap;
            }

            return bitmap;
        } catch (Exception e) {
            Log.e(TAG, "Error generating Code 39 barcode", e);
            return null;
        }
    }

    private String getEncoding(char c) {
        String s = String.valueOf(c);
        for (int i = 0; i < CHARACTERS.length; i++) {
            if (CHARACTERS[i].equals(s)) {
                return ENCODINGS[i];
            }
        }
        return null;
    }

    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(context, InvoiceCarrierWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
            new ComponentName(context, InvoiceCarrierWidgetProvider.class)
        );
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
