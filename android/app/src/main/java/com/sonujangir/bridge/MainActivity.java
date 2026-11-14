package com.sonujangir.bridge;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.Executor;

public class MainActivity extends AppCompatActivity implements BridgeClient.BridgeEventListener {

    private WebView webView;
    private BridgeClient bridgeClient;
    private String currentHost = "gintama-remote-desktop.onrender.com";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        requestNotificationPermission();

        SharedPreferences prefs = getSharedPreferences("bridge_prefs", MODE_PRIVATE);
        currentHost = prefs.getString("relay_host", "gintama-remote-desktop.onrender.com");

        bridgeClient = new BridgeClient(this);
        bridgeClient.setRelayHost(currentHost);
        ApprovalActionReceiver.bridgeClientInstance = bridgeClient;

        setupWebView();
        bridgeClient.connect();

        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = findViewById(R.id.webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidBridge(), "Android");

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void requestNotificationPermission() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
    }

    private void handleNotificationIntent(android.content.Intent intent) {
        if (intent != null && intent.hasExtra("open_rid")) {
            String rid = intent.getStringExtra("open_rid");
            String tool = intent.getStringExtra("tool");
            String command = intent.getStringExtra("command");
            String cwd = intent.getStringExtra("cwd");

            ApprovalItem item = new ApprovalItem(rid, tool, command, cwd, "", "", 120000);
            onApprovalRequest(item);
        }
    }

    // ==========================================
    // BridgeClient Callbacks
    // ==========================================
    @Override
    public void onConnectionStateChanged(boolean isConnected) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if(window.onConnectionState) window.onConnectionState(" + isConnected + ");", null);
            }
        });
    }

    @Override
    public void onApprovalRequest(ApprovalItem item) {
        runOnUiThread(() -> {
            try {
                JSONObject json = new JSONObject();
                json.put("rid", item.rid);
                json.put("tool", item.tool);
                json.put("command", item.command);
                json.put("cwd", item.cwd);

                if (webView != null) {
                    webView.evaluateJavascript("if(window.onApprovalRequest) window.onApprovalRequest(" + json.toString() + ");", null);
                }
            } catch (Exception ignored) {}
        });

        // Trigger native vibration & priority banner
        NotificationHelper.showApprovalNotification(this, item);
    }

    @Override
    public void onApprovalExpired(String rid) {
        runOnUiThread(() -> {
            NotificationHelper.cancelNotification(this, rid);
        });
    }

    @Override
    public void onAppsListReceived(List<AppItem> apps) {
        runOnUiThread(() -> {
            try {
                JSONArray array = new JSONArray();
                for (AppItem app : apps) {
                    JSONObject obj = new JSONObject();
                    obj.put("pid", app.pid);
                    obj.put("name", app.name);
                    obj.put("memory", app.memoryMb + " MB");
                    array.put(obj);
                }
                if (webView != null) {
                    webView.evaluateJavascript("if(window.onAppsList) window.onAppsList(" + array.toString() + ");", null);
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onSystemStatsReceived(String statsText) {
        // Stats text
    }

    @Override
    public void onSystemStatsData(JSONObject statsJson) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if(window.onSystemStats) window.onSystemStats(" + statsJson.toString() + ");", null);
            }
        });
    }

    @Override
    public void onScreenshotReceived(byte[] imageBytes) {
        String base64 = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript("if(window.onScreenshot) window.onScreenshot('data:image/jpeg;base64," + base64 + "');", null);
            }
        });
    }

    @Override
    public void onClipboardReceived(String text) {
        if (text == null || text.isEmpty()) return;
        runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    ClipData clip = ClipData.newPlainText("PC Clipboard", text);
                    clipboard.setPrimaryClip(clip);
                }
                String preview = text.length() > 35 ? text.substring(0, 35) + "..." : text;
                Toast.makeText(MainActivity.this, "📋 Copied from PC: " + preview, Toast.LENGTH_SHORT).show();

                if (webView != null) {
                    webView.evaluateJavascript("if(window.onClipboardSync) window.onClipboardSync(" + JSONObject.quote(text) + ");", null);
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onActionSuccess(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private void showBiometricPrompt(String pin) {
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt biometricPrompt = new BiometricPrompt(MainActivity.this, executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        Toast.makeText(MainActivity.this, "Biometric: " + errString, Toast.LENGTH_SHORT).show();
                    }

                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        Toast.makeText(MainActivity.this, "Biometric Verified! Unlocking PC...", Toast.LENGTH_SHORT).show();
                        if (bridgeClient != null) {
                            bridgeClient.unlockLaptop(pin);
                        }
                        if (webView != null) {
                            webView.evaluateJavascript("if(window.onUnlockSuccess) window.onUnlockSuccess();", null);
                        }
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                        Toast.makeText(MainActivity.this, "Fingerprint not recognized", Toast.LENGTH_SHORT).show();
                    }
                });

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Workstation")
                .setSubtitle("Confirm your fingerprint to unlock laptop")
                .setNegativeButtonText("Cancel")
                .build();

        biometricPrompt.authenticate(promptInfo);
    }

    // ==========================================
    // JavaScript Interface (Exposed to Web UI)
    // ==========================================
    public class AndroidBridge {

        @JavascriptInterface
        public void sendDecision(String rid, String decision) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.sendDecision(rid, decision);
                }
                NotificationHelper.cancelNotification(MainActivity.this, rid);
                Toast.makeText(MainActivity.this, "Decision: " + decision.toUpperCase(), Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void lockLaptop() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.lockLaptop();
                }
                Toast.makeText(MainActivity.this, "Lock signal sent to PC", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void sleepDisplay() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.sleepDisplay();
                }
                Toast.makeText(MainActivity.this, "Display sleep signal sent", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void wakeDisplay() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.wakeDisplay();
                }
                Toast.makeText(MainActivity.this, "Display wake signal sent", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void toggleMute() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.toggleMute();
                }
                Toast.makeText(MainActivity.this, "Mute toggle sent to PC", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void adjustVolume(boolean isUp) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.adjustVolume(isUp);
                }
            });
        }

        @JavascriptInterface
        public void setVolume(int percent) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.setVolume(percent);
                }
            });
        }

        @JavascriptInterface
        public void captureScreenshot() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.captureScreenshot();
                }
            });
        }

        @JavascriptInterface
        public void fetchRunningApps() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.fetchRunningApps();
                }
            });
        }

        @JavascriptInterface
        public void closeApp(int pid, boolean force) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.closeApp(pid, force);
                }
                Toast.makeText(MainActivity.this, "Terminating PID " + pid, Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void fetchSystemStats() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.fetchSystemStats();
                }
            });
        }

        @JavascriptInterface
        public void copyToClipboard(String text) {
            runOnUiThread(() -> {
                try {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    ClipData clip = ClipData.newPlainText("Bridge Remote", text);
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(clip);
                        Toast.makeText(MainActivity.this, "Copied to clipboard!", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void vibrate(int durationMs) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(Math.min(durationMs, 400), VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(Math.min(durationMs, 400));
                    }
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void unlockWithBiometrics(String pin) {
            runOnUiThread(() -> {
                showBiometricPrompt(pin);
            });
        }

        @JavascriptInterface
        public void unlockLaptopDirect(String pin) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.unlockLaptop(pin);
                }
                Toast.makeText(MainActivity.this, "Unlock signal sent to PC", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void saveSavedPin(String pin) {
            getSharedPreferences("bridge_prefs", MODE_PRIVATE)
                    .edit()
                    .putString("saved_pin", pin)
                    .apply();
        }

        @JavascriptInterface
        public String getSavedPin() {
            return getSharedPreferences("bridge_prefs", MODE_PRIVATE)
                    .getString("saved_pin", "");
        }

        @JavascriptInterface
        public void sendClipboardToLaptop(String text) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.setLaptopClipboard(text);
                }
                Toast.makeText(MainActivity.this, "Sent to PC Clipboard", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void pasteToLaptop(String text) {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.pasteToLaptop(text);
                }
                Toast.makeText(MainActivity.this, "Pasted on PC Active Window", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void fetchLaptopClipboard() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.fetchLaptopClipboard();
                }
            });
        }

        @JavascriptInterface
        public void peekScreen() {
            runOnUiThread(() -> {
                if (bridgeClient != null) {
                    bridgeClient.peekScreen();
                }
            });
        }

        @JavascriptInterface
        public void saveScreenshotToGallery(String base64Data) {
            runOnUiThread(() -> {
                try {
                    String clean = base64Data != null ? base64Data : "";
                    if (clean.contains(",")) clean = clean.substring(clean.indexOf(",") + 1);
                    byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
                    android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bmp != null) {
                        String title = "BridgeScreenshot_" + System.currentTimeMillis();
                        android.provider.MediaStore.Images.Media.insertImage(getContentResolver(), bmp, title, "Captured via Bridge Remote");
                        Toast.makeText(MainActivity.this, "📸 Screenshot saved to Gallery!", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Failed to save: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String getPhoneClipboard() {
            try {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
                    CharSequence text = clipboard.getPrimaryClip().getItemAt(0).getText();
                    return text != null ? text.toString() : "";
                }
            } catch (Exception ignored) {}
            return "";
        }

        @JavascriptInterface
        public void saveSettings(String host) {
            runOnUiThread(() -> {
                getSharedPreferences("bridge_prefs", MODE_PRIVATE)
                        .edit()
                        .putString("relay_host", host)
                        .apply();

                if (bridgeClient != null) {
                    bridgeClient.setRelayHost(host);
                    bridgeClient.connect();
                }
                Toast.makeText(MainActivity.this, "Connecting to: " + host, Toast.LENGTH_SHORT).show();
            });
        }
    }
}
