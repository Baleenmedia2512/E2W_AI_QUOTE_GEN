package com.baleenmedia.quotegen;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "DownloadNotification")
public class DownloadNotificationPlugin extends Plugin {

    private static final String CHANNEL_ID = "download_channel";
    private static final String CHANNEL_NAME = "Downloads";
    private static final int NOTIFICATION_ID = 1;

    @PluginMethod
    public void showDownloadNotification(PluginCall call) {
        String filePath = call.getString("filePath");
        String fileName = call.getString("fileName");
        String title = call.getString("title", "Download Complete");
        String message = call.getString("message", "File downloaded successfully");

        if (filePath == null || fileName == null) {
            call.reject("Missing required parameters");
            return;
        }

        Context context = getContext();
        NotificationManager notificationManager = 
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        // Create notification channel for Android O and above
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Download notifications");
            notificationManager.createNotificationChannel(channel);
        }

        // Create intent to open the file
        File file = new File(filePath);
        Uri fileUri;
        
        try {
            // Use FileProvider for Android 7.0+ to access the file securely
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                fileUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    file
                );
            } else {
                fileUri = Uri.fromFile(file);
            }

            Intent openIntent = new Intent(Intent.ACTION_VIEW);
            openIntent.setDataAndType(fileUri, "application/pdf");
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Build the notification
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(message)
                .setSubText(fileName)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

            // Show the notification
            notificationManager.notify(NOTIFICATION_ID, builder.build());

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Notification shown successfully");
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to show notification: " + e.getMessage());
        }
    }
}
