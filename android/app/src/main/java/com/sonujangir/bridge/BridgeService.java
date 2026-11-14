package com.sonujangir.bridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.widget.Toast;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.util.List;

public class BridgeService extends Service implements BridgeClient.BridgeEventListener {

    public static final String CHANNEL_SERVICE_ID = "bridge_foreground_service";
    public static final String CHANNEL_CLIPBOARD_ID = "bridge_clipboard_channel";
    public static final int SERVICE_NOTIFICATION_ID = 9001;

    private static BridgeService instance;
    private BridgeClient bridgeClient;
    private String pendingClipboardText = null;
    private boolean isActivityVisible = false;

    public interface ServiceCallback {
        void onConnectionStateChanged(boolean isConnected);
        void onApprovalRequest(ApprovalItem item);
        void onApprovalExpired(String rid);
        void onAppsListReceived(List<AppItem> apps);
        void onSystemStatsReceived(String statsText);
        void onSystemStatsData(JSONObject statsJson);
        void onScreenshotReceived(byte[] imageBytes);
        void onClipboardReceived(String text);
        void onActionSuccess(String message);
    }

    private ServiceCallback activityCallback;

    public static BridgeService getInstance() {
        return instance;
    }

    public BridgeClient getBridgeClient() {
        return bridgeClient;
    }

    public void setActivityCallback(ServiceCallback callback) {
        this.activityCallback = callback;
    }

    public void setActivityVisible(boolean visible) {
        this.isActivityVisible = visible;
        if (visible && pendingClipboardText != null) {
            copyToSystemClipboard(pendingClipboardText);
            pendingClipboardText = null;
        }
    }

    public String getPendingClipboardText() {
        return pendingClipboardText;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels();
        startForeground(SERVICE_NOTIFICATION_ID, buildForegroundNotification("Connecting to relay..."));

        SharedPreferences prefs = getSharedPreferences("bridge_prefs", MODE_PRIVATE);
        String currentHost = prefs.getString("relay_host", "gintama-remote-desktop.onrender.com");

        bridgeClient = new BridgeClient(this);
        bridgeClient.setRelayHost(currentHost);
        ApprovalActionReceiver.bridgeClientInstance = bridgeClient;
        bridgeClient.connect();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String act = intent.getAction();
            if ("ACTION_LOCK_PC".equals(act)) {
                if (bridgeClient != null) bridgeClient.lockLaptop();
                Toast.makeText(this, "🔒 Locking PC...", Toast.LENGTH_SHORT).show();
            } else if ("ACTION_SCREENSHOT".equals(act)) {
                if (bridgeClient != null) bridgeClient.captureScreenshot();
                Toast.makeText(this, "📸 Capturing PC screen...", Toast.LENGTH_SHORT).show();
            } else if ("ACTION_COPY_CLIPBOARD".equals(act)) {
                String text = intent.getStringExtra("text");
                if (text != null) {
                    copyToSystemClipboard(text);
                    Toast.makeText(this, "📋 Copied to Phone Clipboard!", Toast.LENGTH_SHORT).show();
                }
            }
        }
        return START_STICKY;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;

            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_SERVICE_ID,
                    "Bridge Background Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Keeps Bridge Remote connected 24/7 in background");
            serviceChannel.setShowBadge(false);
            nm.createNotificationChannel(serviceChannel);

            NotificationChannel clipChannel = new NotificationChannel(
                    CHANNEL_CLIPBOARD_ID,
                    "PC Clipboard Sync Alerts",
                    NotificationManager.IMPORTANCE_HIGH
            );
            clipChannel.setDescription("Alerts when new text is copied from PC");
            clipChannel.enableVibration(true);
            clipChannel.setVibrationPattern(new long[]{0, 150});
            nm.createNotificationChannel(clipChannel);
        }
    }

    private Notification buildForegroundNotification(String status) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent lockIntent = new Intent(this, BridgeService.class);
        lockIntent.setAction("ACTION_LOCK_PC");
        PendingIntent lockPi = PendingIntent.getService(
                this, 1, lockIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent shotIntent = new Intent(this, BridgeService.class);
        shotIntent.setAction("ACTION_SCREENSHOT");
        PendingIntent shotPi = PendingIntent.getService(
                this, 2, shotIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_SERVICE_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Bridge Remote • 24/7 Background Sync")
                .setContentText(status)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pi)
                .addAction(android.R.drawable.ic_lock_power_off, "Lock PC", lockPi)
                .addAction(android.R.drawable.ic_menu_camera, "Screenshot", shotPi)
                .build();
    }

    private void updateServiceNotification(String status) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(SERVICE_NOTIFICATION_ID, buildForegroundNotification(status));
        }
    }

    private void copyToSystemClipboard(String text) {
        try {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                ClipData clip = ClipData.newPlainText("PC Clipboard", text);
                cm.setPrimaryClip(clip);
            }
        } catch (Exception ignored) {}
    }

    private void showClipboardNotification(String text) {
        Intent copyIntent = new Intent(this, BridgeService.class);
        copyIntent.setAction("ACTION_COPY_CLIPBOARD");
        copyIntent.putExtra("text", text);
        PendingIntent copyPi = PendingIntent.getService(
                this, (int) (System.currentTimeMillis() & 0xfffffff), copyIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
                this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String preview = text.length() > 60 ? text.substring(0, 60) + "..." : text;

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_CLIPBOARD_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("📋 Copied from PC")
                .setContentText(preview)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openPi)
                .addAction(android.R.drawable.ic_menu_save, "Copy to Phone", copyPi);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(8888, b.build());
        }
    }

    // BridgeEventListener Callbacks
    @Override
    public void onConnectionStateChanged(boolean isConnected) {
        updateServiceNotification(isConnected ? "Connected to Laptop (dev_laptop_01)" : "Waiting for Relay connection...");
        if (activityCallback != null) {
            activityCallback.onConnectionStateChanged(isConnected);
        }
    }

    @Override
    public void onApprovalRequest(ApprovalItem item) {
        NotificationHelper.showApprovalNotification(this, item);
        if (activityCallback != null) {
            activityCallback.onApprovalRequest(item);
        }
    }

    @Override
    public void onApprovalExpired(String rid) {
        NotificationHelper.cancelNotification(this, rid);
        if (activityCallback != null) {
            activityCallback.onApprovalExpired(rid);
        }
    }

    @Override
    public void onAppsListReceived(List<AppItem> apps) {
        if (activityCallback != null) {
            activityCallback.onAppsListReceived(apps);
        }
    }

    @Override
    public void onSystemStatsReceived(String statsText) {
        if (activityCallback != null) {
            activityCallback.onSystemStatsReceived(statsText);
        }
    }

    @Override
    public void onSystemStatsData(JSONObject statsJson) {
        if (activityCallback != null) {
            activityCallback.onSystemStatsData(statsJson);
        }
    }

    @Override
    public void onScreenshotReceived(byte[] imageBytes) {
        if (activityCallback != null) {
            activityCallback.onScreenshotReceived(imageBytes);
        }
    }

    @Override
    public void onClipboardReceived(String text) {
        if (text == null || text.isEmpty()) return;

        if (isActivityVisible) {
            copyToSystemClipboard(text);
        } else {
            pendingClipboardText = text;
            showClipboardNotification(text);
        }

        if (activityCallback != null) {
            activityCallback.onClipboardReceived(text);
        }
    }

    @Override
    public void onActionSuccess(String message) {
        if (activityCallback != null) {
            activityCallback.onActionSuccess(message);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (bridgeClient != null) {
            bridgeClient.disconnect();
        }
        instance = null;
        super.onDestroy();
    }
}

