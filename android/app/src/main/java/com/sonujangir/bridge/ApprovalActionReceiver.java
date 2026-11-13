package com.sonujangir.bridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

public class ApprovalActionReceiver extends BroadcastReceiver {

    public static BridgeClient bridgeClientInstance;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String rid = intent.getStringExtra("rid");

        if (rid == null) return;

        NotificationHelper.cancelNotification(context, rid);

        if ("ACTION_ALLOW".equals(action)) {
            if (bridgeClientInstance != null) {
                bridgeClientInstance.sendDecision(rid, "allow");
            }
            Toast.makeText(context, "🟢 Allowed command " + rid, Toast.LENGTH_SHORT).show();
        } else if ("ACTION_DENY".equals(action)) {
            if (bridgeClientInstance != null) {
                bridgeClientInstance.sendDecision(rid, "deny");
            }
            Toast.makeText(context, "🔴 Denied command " + rid, Toast.LENGTH_SHORT).show();
        }
    }
}

