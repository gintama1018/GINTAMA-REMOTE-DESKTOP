package com.sonujangir.bridge;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

public class NotificationHelper {

    public static final String CHANNEL_ID = "bridge_agent_approvals";
    private static final String CHANNEL_NAME = "Antigravity Agent Approvals";

    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("High priority alerts for AI agent permission requests");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 100, 250});
            channel.enableLights(true);

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static void showApprovalNotification(Context context, ApprovalItem item) {
        createNotificationChannel(context);

        // Intent to launch MainActivity and open the Half-Screen Bottom Sheet Dialog
        Intent contentIntent = new Intent(context, MainActivity.class);
        contentIntent.putExtra("open_rid", item.rid);
        contentIntent.putExtra("tool", item.tool);
        contentIntent.putExtra("command", item.command);
        contentIntent.putExtra("cwd", item.cwd);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                context,
                item.rid.hashCode(),
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Direct Action: Deny
        Intent denyIntent = new Intent(context, ApprovalActionReceiver.class);
        denyIntent.setAction("ACTION_DENY");
        denyIntent.putExtra("rid", item.rid);
        PendingIntent denyPendingIntent = PendingIntent.getBroadcast(
                context,
                (item.rid + "_deny").hashCode(),
                denyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Direct Action: Allow
        Intent allowIntent = new Intent(context, ApprovalActionReceiver.class);
        allowIntent.setAction("ACTION_ALLOW");
        allowIntent.putExtra("rid", item.rid);
        PendingIntent allowPendingIntent = PendingIntent.getBroadcast(
                context,
                (item.rid + "_allow").hashCode(),
                allowIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("⚠️ Permission Required: " + (item.tool != null ? item.tool : "Agent Command"))
                .setContentText(item.command != null ? item.command : "Tap to review command")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .setBigContentTitle("⚡ Antigravity: " + item.tool)
                        .bigText("Command:\n" + item.command + "\n\nDir: " + item.cwd))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(contentPendingIntent)
                .addAction(android.R.drawable.ic_delete, "Deny", denyPendingIntent)
                .addAction(android.R.drawable.ic_input_add, "Allow", allowPendingIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(item.rid.hashCode(), builder.build());
        }
    }

    public static void cancelNotification(Context context, String rid) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && rid != null) {
            manager.cancel(rid.hashCode());
        }
    }

    public static final String FILES_CHANNEL_ID = "bridge_files_channel";
    private static final String FILES_CHANNEL_NAME = "Bridge File Transfers";

    public static void createFileNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    FILES_CHANNEL_ID,
                    FILES_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications for files transferred from PC");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 200, 100, 200});

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static void showFileReceivedNotification(Context context, String filename, java.io.File file, long sizeBytes) {
        createFileNotificationChannel(context);

        String mimeType = "*/*";
        int idx = filename.lastIndexOf('.');
        if (idx >= 0) {
            String ext = filename.substring(idx + 1).toLowerCase();
            String foundMime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (foundMime != null) mimeType = foundMime;
            if ("apk".equals(ext)) mimeType = "application/vnd.android.package-archive";
        }

        PendingIntent openPendingIntent = null;
        PendingIntent sharePendingIntent = null;

        if (file != null && file.exists()) {
            try {
                android.net.Uri contentUri = androidx.core.content.FileProvider.getUriForFile(
                        context,
                        context.getPackageName() + ".fileprovider",
                        file
                );

                Intent openIntent = new Intent(Intent.ACTION_VIEW);
                openIntent.setDataAndType(contentUri, mimeType);
                openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                openPendingIntent = PendingIntent.getActivity(
                        context,
                        filename.hashCode(),
                        openIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(shareIntent, "Share " + filename);
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                sharePendingIntent = PendingIntent.getActivity(
                        context,
                        (filename + "_share").hashCode(),
                        chooser,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );
            } catch (Exception e) {
                android.util.Log.e("NotificationHelper", "Error building file intents: " + e.getMessage());
            }
        }

        String sizeText = sizeBytes > 1024 * 1024
                ? String.format(java.util.Locale.US, "%.1f MB", sizeBytes / (1024.0 * 1024.0))
                : (sizeBytes / 1024) + " KB";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, FILES_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("📥 Received: " + filename)
                .setContentText(sizeText + " • Tap to open")
                .setStyle(new NotificationCompat.BigTextStyle()
                        .setBigContentTitle("📥 File Received from PC")
                        .bigText("File: " + filename + "\nSize: " + sizeText + "\nLocation: Downloads/BridgeRemote\n\nTap to open immediately."))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true);

        if (openPendingIntent != null) {
            builder.setContentIntent(openPendingIntent);
            builder.addAction(android.R.drawable.ic_menu_view, "Open", openPendingIntent);
        }
        if (sharePendingIntent != null) {
            builder.addAction(android.R.drawable.ic_menu_share, "Share", sharePendingIntent);
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(filename.hashCode(), builder.build());
        }
    }
}

