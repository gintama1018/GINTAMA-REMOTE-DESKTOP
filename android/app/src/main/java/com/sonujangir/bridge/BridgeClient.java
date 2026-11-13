package com.sonujangir.bridge;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class BridgeClient {

    private static final String TAG = "BridgeClient";

    public interface BridgeEventListener {
        void onConnectionStateChanged(boolean isConnected);
        void onApprovalRequest(ApprovalItem item);
        void onApprovalExpired(String rid);
        void onAppsListReceived(List<AppItem> apps);
        void onSystemStatsReceived(String statsText);
        void onSystemStatsData(JSONObject statsJson);
        void onScreenshotReceived(byte[] imageBytes);
        void onActionSuccess(String message);
    }

    private final String deviceId = "dev_phone_01";
    private final String peerDesktopId = "dev_laptop_01";
    private String relayHost = "gintama-remote-desktop.onrender.com";

    private OkHttpClient httpClient;
    private WebSocket webSocket;
    private BridgeEventListener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean isConnected = false;

    public BridgeClient(BridgeEventListener listener) {
        this.listener = listener;
        this.httpClient = new OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(20, TimeUnit.SECONDS)
                .build();
    }

    public void setRelayHost(String host) {
        this.relayHost = host.trim();
    }

    public String getRelayHost() {
        return this.relayHost;
    }

    public void connect() {
        disconnect();

        String clean = (relayHost != null ? relayHost.trim() : "");
        clean = clean.replaceAll("/+$", "");
        if (clean.endsWith("/v1/connect")) {
            clean = clean.substring(0, clean.length() - "/v1/connect".length());
        }

        String scheme = "ws://";
        if (clean.startsWith("wss://")) {
            scheme = "wss://";
            clean = clean.substring(6);
        } else if (clean.startsWith("ws://")) {
            scheme = "ws://";
            clean = clean.substring(5);
        } else if (clean.startsWith("https://")) {
            scheme = "wss://";
            clean = clean.substring(8);
        } else if (clean.startsWith("http://")) {
            scheme = "ws://";
            clean = clean.substring(7);
        } else if (clean.contains(".onrender.com") || (!clean.contains(":") && !clean.contains("127.0.0.1") && !clean.contains("localhost"))) {
            scheme = "wss://";
        }

        String url = scheme + clean + "/v1/connect?deviceId=" + deviceId + "&role=phone";
        Log.d(TAG, "Connecting to: " + url);

        Request request = new Request.Builder().url(url).build();
        webSocket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                Log.d(TAG, "Connected to Relay!");
                isConnected = true;
                mainHandler.post(() -> listener.onConnectionStateChanged(true));
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                handleMessage(text);
            }

            @Override
            public void onClosing(WebSocket ws, int code, String reason) {
                ws.close(1000, null);
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                isConnected = false;
                mainHandler.post(() -> listener.onConnectionStateChanged(false));
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                Log.e(TAG, "WebSocket failure: " + t.getMessage());
                isConnected = false;
                mainHandler.post(() -> listener.onConnectionStateChanged(false));
            }
        });
    }

    public void disconnect() {
        if (webSocket != null) {
            webSocket.close(1000, "Normal closure");
            webSocket = null;
        }
        isConnected = false;
    }

    public boolean isConnected() {
        return isConnected;
    }

    private void handleMessage(String rawJson) {
        try {
            JSONObject envelope = new JSONObject(rawJson);
            if (!envelope.has("payload")) return;

            JSONObject payload = envelope.getJSONObject("payload");
            String type = payload.optString("t", "");
            String rid = payload.optString("rid", "");

            if ("approval.request".equals(type)) {
                JSONObject body = payload.getJSONObject("body");
                ApprovalItem item = new ApprovalItem(
                        rid,
                        body.optString("tool", "run_command"),
                        body.optString("command", ""),
                        body.optString("cwd", ""),
                        body.optString("workspace", ""),
                        body.optString("conversation", ""),
                        body.optLong("remaining_ms", 120000)
                );
                mainHandler.post(() -> listener.onApprovalRequest(item));
            } else if ("approval.expired".equals(type)) {
                mainHandler.post(() -> listener.onApprovalExpired(rid));
            } else if ("action.result".equals(type)) {
                JSONObject body = payload.optJSONObject("body");
                if (body != null) {
                    if (body.has("apps")) {
                        JSONArray appsArr = body.getJSONArray("apps");
                        List<AppItem> list = new ArrayList<>();
                        for (int i = 0; i < appsArr.length(); i++) {
                            JSONObject a = appsArr.getJSONObject(i);
                            list.add(new AppItem(
                                    a.optInt("pid"),
                                    a.optString("name"),
                                    a.optString("title"),
                                    a.optInt("memoryMb"),
                                    a.optBoolean("responding", true)
                            ));
                        }
                        mainHandler.post(() -> listener.onAppsListReceived(list));
                    } else if (body.has("stats")) {
                        JSONObject s = body.getJSONObject("stats");
                        JSONObject mem = s.optJSONObject("memory");
                        JSONObject bat = s.optJSONObject("battery");

                        StringBuilder sb = new StringBuilder();
                        sb.append("💻 Hostname: ").append(s.optString("hostname", "Unknown")).append("\n");
                        if (bat != null) {
                            sb.append("🔋 Battery: ").append(bat.optInt("percentage", 100)).append("% ");
                            sb.append(bat.optBoolean("isCharging", false) ? "(⚡ Charging)" : "(Discharging)").append("\n");
                        }
                        if (mem != null) {
                            sb.append("🧠 RAM: ").append(mem.optInt("usedMb")).append(" MB / ")
                              .append(mem.optInt("totalMb")).append(" MB (")
                              .append(mem.optInt("usedPct")).append("% used)\n");
                        }
                        sb.append("⚙️ CPU Cores: ").append(s.optInt("cpuCount", 0));

                        mainHandler.post(() -> {
                            listener.onSystemStatsReceived(sb.toString());
                            listener.onSystemStatsData(s);
                        });
                    } else if (body.has("imageBase64")) {
                        String b64 = body.getString("imageBase64");
                        byte[] imageBytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                        mainHandler.post(() -> listener.onScreenshotReceived(imageBytes));
                    } else if (body.has("message")) {
                        String msg = body.getString("message");
                        mainHandler.post(() -> listener.onActionSuccess(msg));
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling message: " + e.getMessage());
        }
    }

    public void sendDecision(String rid, String decision) {
        if (!isConnected || webSocket == null) return;
        try {
            JSONObject envelope = new JSONObject();
            envelope.put("v", 1);
            envelope.put("msg_id", "dec_" + System.currentTimeMillis());
            envelope.put("from", deviceId);
            envelope.put("to", peerDesktopId);
            envelope.put("seq", 1);
            envelope.put("class", "interactive");

            JSONObject payload = new JSONObject();
            payload.put("t", "approval.decision");
            payload.put("rid", rid);

            JSONObject body = new JSONObject();
            body.put("decision", decision);
            body.put("sig", "biometric_ecdsa_signed");
            payload.put("body", body);

            envelope.put("payload", payload);
            webSocket.send(envelope.toString());
        } catch (Exception e) {
            Log.e(TAG, "Failed to send decision: " + e.getMessage());
        }
    }

    public void requestAction(String actionName, JSONObject args) {
        if (!isConnected || webSocket == null) return;
        try {
            JSONObject envelope = new JSONObject();
            envelope.put("v", 1);
            envelope.put("msg_id", "act_" + System.currentTimeMillis());
            envelope.put("from", deviceId);
            envelope.put("to", peerDesktopId);
            envelope.put("seq", 1);
            envelope.put("class", "interactive");

            JSONObject payload = new JSONObject();
            payload.put("t", "action.request");
            payload.put("rid", "act_" + System.currentTimeMillis());

            JSONObject body = new JSONObject();
            body.put("action", actionName);
            body.put("args", args != null ? args : new JSONObject());
            payload.put("body", body);

            envelope.put("payload", payload);
            webSocket.send(envelope.toString());
        } catch (Exception e) {
            Log.e(TAG, "Failed to send action: " + e.getMessage());
        }
    }

    public void captureScreenshot() {
        requestAction("screenshot", new JSONObject());
    }

    public void lockLaptop() {
        requestAction("lock", new JSONObject());
    }

    public void fetchSystemStats() {
        requestAction("system_stats", new JSONObject());
    }

    public void fetchRunningApps() {
        requestAction("list_apps", new JSONObject());
    }

    public void closeApp(int pid, boolean force) {
        try {
            JSONObject args = new JSONObject();
            args.put("pid", pid);
            args.put("force", force);
            requestAction("close_app", args);
        } catch (Exception ignored) {}
    }

    public void sleepDisplay() {
        requestAction("sleep_display", new JSONObject());
    }

    public void wakeDisplay() {
        requestAction("wake_display", new JSONObject());
    }

    public void toggleMute() {
        requestAction("toggle_mute", new JSONObject());
    }

    public void adjustVolume(boolean isUp) {
        try {
            JSONObject args = new JSONObject();
            args.put("isUp", isUp);
            requestAction("adjust_volume", args);
        } catch (Exception ignored) {}
    }

    public void setVolume(int percent) {
        try {
            JSONObject args = new JSONObject();
            args.put("percent", percent);
            requestAction("set_volume", args);
        } catch (Exception ignored) {}
    }
}

