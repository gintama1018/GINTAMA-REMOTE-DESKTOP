package com.sonujangir.bridge;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.google.android.material.bottomnavigation.BottomNavigationView;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

public class MainActivity extends AppCompatActivity implements BridgeClient.BridgeEventListener {

    private BridgeClient bridgeClient;

    // UI Elements
    private TextView tvStatusBadge;
    private View pageApprovals, pageApps, pageControls, pageSettings;
    private BottomNavigationView bottomNav;

    // Approvals
    private TextView tvEmptyApprovals;
    private RecyclerView rvApprovals;
    private ApprovalsAdapter approvalsAdapter;
    private final List<ApprovalItem> approvalList = new ArrayList<>();

    // Apps
    private TextView tvEmptyApps;
    private RecyclerView rvApps;
    private AppsAdapter appsAdapter;
    private final List<AppItem> appList = new ArrayList<>();
    private Button btnRefreshApps;

    // Controls
    private Button btnLockScreen, btnRefreshStats, btnCaptureScreen;
    private TextView tvLaptopStats, tvScreenshotTime;
    private android.widget.ImageView ivScreenshot;
    private android.widget.ProgressBar pbScreenshotLoading;

    // Settings
    private EditText etRelayHost;
    private Button btnSaveAndConnect;

    // Biometric
    private Executor biometricExecutor;
    private BiometricPrompt biometricPrompt;
    private BiometricPrompt.PromptInfo promptInfo;
    private ApprovalItem pendingBiometricItem;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        requestNotificationPermission();
        initViews();
        setupBiometrics();
        setupNavigation();

        bridgeClient = new BridgeClient(this);
        ApprovalActionReceiver.bridgeClientInstance = bridgeClient;
        bridgeClient.connect();

        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
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
            showSiriStyleBottomSheet(item);
        }
    }

    private void initViews() {
        tvStatusBadge = findViewById(R.id.tvStatusBadge);
        bottomNav = findViewById(R.id.bottomNav);

        pageApprovals = findViewById(R.id.pageApprovals);
        pageApps = findViewById(R.id.pageApps);
        pageControls = findViewById(R.id.pageControls);
        pageSettings = findViewById(R.id.pageSettings);

        // Approvals setup
        tvEmptyApprovals = findViewById(R.id.tvEmptyApprovals);
        rvApprovals = findViewById(R.id.rvApprovals);
        rvApprovals.setLayoutManager(new LinearLayoutManager(this));
        approvalsAdapter = new ApprovalsAdapter(approvalList, new ApprovalsAdapter.OnApprovalActionListener() {
            @Override
            public void onAllow(ApprovalItem item) {
                requestBiometricApproval(item);
            }

            @Override
            public void onDeny(ApprovalItem item) {
                bridgeClient.sendDecision(item.rid, "deny");
                removeApproval(item.rid);
                Toast.makeText(MainActivity.this, "Denied command " + item.rid, Toast.LENGTH_SHORT).show();
            }
        });
        rvApprovals.setAdapter(approvalsAdapter);

        // Apps setup
        tvEmptyApps = findViewById(R.id.tvEmptyApps);
        rvApps = findViewById(R.id.rvApps);
        rvApps.setLayoutManager(new LinearLayoutManager(this));
        appsAdapter = new AppsAdapter(appList, new AppsAdapter.OnAppActionListener() {
            @Override
            public void onClose(AppItem item) {
                bridgeClient.closeApp(item.pid, false);
                Toast.makeText(MainActivity.this, "Closing " + item.name + "...", Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onForceKill(AppItem item) {
                bridgeClient.closeApp(item.pid, true);
                Toast.makeText(MainActivity.this, "Force terminated " + item.name, Toast.LENGTH_SHORT).show();
            }
        });
        rvApps.setAdapter(appsAdapter);
        btnRefreshApps = findViewById(R.id.btnRefreshApps);
        btnRefreshApps.setOnClickListener(v -> bridgeClient.fetchRunningApps());

        // Controls setup
        btnLockScreen = findViewById(R.id.btnLockScreen);
        btnLockScreen.setOnClickListener(v -> {
            bridgeClient.lockLaptop();
            Toast.makeText(this, "Lock signal sent to laptop", Toast.LENGTH_SHORT).show();
        });
        btnRefreshStats = findViewById(R.id.btnRefreshStats);
        btnRefreshStats.setOnClickListener(v -> bridgeClient.fetchSystemStats());
        tvLaptopStats = findViewById(R.id.tvLaptopStats);

        btnCaptureScreen = findViewById(R.id.btnCaptureScreen);
        ivScreenshot = findViewById(R.id.ivScreenshot);
        pbScreenshotLoading = findViewById(R.id.pbScreenshotLoading);
        tvScreenshotTime = findViewById(R.id.tvScreenshotTime);

        btnCaptureScreen.setOnClickListener(v -> {
            pbScreenshotLoading.setVisibility(View.VISIBLE);
            tvScreenshotTime.setText("Capturing desktop snapshot...");
            bridgeClient.captureScreenshot();
        });

        // Settings setup
        etRelayHost = findViewById(R.id.etRelayHost);
        android.content.SharedPreferences prefs = getSharedPreferences("bridge_prefs", MODE_PRIVATE);
        String savedHost = prefs.getString("relay_host", "gintama-remote-desktop.onrender.com");
        etRelayHost.setText(savedHost);
        if (bridgeClient != null) {
            bridgeClient.setRelayHost(savedHost);
        }

        btnSaveAndConnect = findViewById(R.id.btnSaveAndConnect);
        btnSaveAndConnect.setOnClickListener(v -> {
            String host = etRelayHost.getText().toString().trim();
            if (!host.isEmpty()) {
                prefs.edit().putString("relay_host", host).apply();
                bridgeClient.setRelayHost(host);
                bridgeClient.connect();
                Toast.makeText(this, "Connecting to " + host + "...", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void setupBiometrics() {
        biometricExecutor = ContextCompat.getMainExecutor(this);
        biometricPrompt = new BiometricPrompt(this, biometricExecutor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                if (pendingBiometricItem != null) {
                    bridgeClient.sendDecision(pendingBiometricItem.rid, "allow");
                    removeApproval(pendingBiometricItem.rid);
                    Toast.makeText(MainActivity.this, "🟢 Approved " + pendingBiometricItem.rid + " via Biometric", Toast.LENGTH_SHORT).show();
                    pendingBiometricItem = null;
                }
            }

            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                Toast.makeText(MainActivity.this, "Authentication failed: " + errString, Toast.LENGTH_SHORT).show();
                pendingBiometricItem = null;
            }
        });

        promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Approve Agent Command")
                .setSubtitle("Confirm your identity to authorize command on laptop")
                .setNegativeButtonText("Cancel")
                .build();
    }

    private void showSiriStyleBottomSheet(ApprovalItem item) {
        com.google.android.material.bottomsheet.BottomSheetDialog bottomSheetDialog = 
                new com.google.android.material.bottomsheet.BottomSheetDialog(this);
        View sheetView = getLayoutInflater().inflate(R.layout.dialog_approval_bottom_sheet, null);
        bottomSheetDialog.setContentView(sheetView);

        TextView bsRequestId = sheetView.findViewById(R.id.bsRequestId);
        TextView bsToolBadge = sheetView.findViewById(R.id.bsToolBadge);
        TextView bsCommand = sheetView.findViewById(R.id.bsCommand);
        TextView bsCwd = sheetView.findViewById(R.id.bsCwd);
        Button bsBtnDeny = sheetView.findViewById(R.id.bsBtnDeny);
        Button bsBtnAllow = sheetView.findViewById(R.id.bsBtnAllow);

        bsRequestId.setText("ID: " + item.rid);
        bsToolBadge.setText(item.tool != null ? item.tool : "run_command");
        bsCommand.setText(item.command != null ? item.command : "(no command)");
        bsCwd.setText("Directory: " + (item.cwd != null && !item.cwd.isEmpty() ? item.cwd : "Default Workspace"));

        bsBtnDeny.setOnClickListener(v -> {
            bridgeClient.sendDecision(item.rid, "deny");
            NotificationHelper.cancelNotification(this, item.rid);
            removeApproval(item.rid);
            bottomSheetDialog.dismiss();
            Toast.makeText(this, "🔴 Denied " + item.rid, Toast.LENGTH_SHORT).show();
        });

        bsBtnAllow.setOnClickListener(v -> {
            bottomSheetDialog.dismiss();
            requestBiometricApproval(item);
        });

        bottomSheetDialog.show();
    }

    private void requestBiometricApproval(ApprovalItem item) {
        this.pendingBiometricItem = item;
        try {
            biometricPrompt.authenticate(promptInfo);
        } catch (Exception e) {
            // Fallback for devices without biometric enrollment
            bridgeClient.sendDecision(item.rid, "allow");
            removeApproval(item.rid);
            Toast.makeText(this, "Approved (direct)", Toast.LENGTH_SHORT).show();
        }
    }

    private void removeApproval(String rid) {
        for (int i = 0; i < approvalList.size(); i++) {
            if (approvalList.get(i).rid.equals(rid)) {
                approvalList.remove(i);
                approvalsAdapter.notifyItemRemoved(i);
                break;
            }
        }
        updateApprovalsVisibility();
    }

    private void updateApprovalsVisibility() {
        if (approvalList.isEmpty()) {
            tvEmptyApprovals.setVisibility(View.VISIBLE);
            rvApprovals.setVisibility(View.GONE);
        } else {
            tvEmptyApprovals.setVisibility(View.GONE);
            rvApprovals.setVisibility(View.VISIBLE);
        }
    }

    private void setupNavigation() {
        bottomNav.setOnItemSelectedListener(item -> {
            int id = item.getItemId();
            pageApprovals.setVisibility(id == R.id.nav_approvals ? View.VISIBLE : View.GONE);
            pageApps.setVisibility(id == R.id.nav_apps ? View.VISIBLE : View.GONE);
            pageControls.setVisibility(id == R.id.nav_controls ? View.VISIBLE : View.GONE);
            pageSettings.setVisibility(id == R.id.nav_settings ? View.VISIBLE : View.GONE);

            if (id == R.id.nav_apps) {
                bridgeClient.fetchRunningApps();
            } else if (id == R.id.nav_controls) {
                bridgeClient.fetchSystemStats();
            }
            return true;
        });
    }

    @Override
    public void onConnectionStateChanged(boolean isConnected) {
        if (isConnected) {
            tvStatusBadge.setText("● Online");
            tvStatusBadge.setTextColor(0xFF10B981); // Green
            bridgeClient.fetchSystemStats();
        } else {
            tvStatusBadge.setText("● Offline");
            tvStatusBadge.setTextColor(0xFFEF4444); // Red
        }
    }

    @Override
    public void onApprovalRequest(ApprovalItem item) {
        approvalList.add(0, item);
        approvalsAdapter.notifyItemInserted(0);
        updateApprovalsVisibility();

        // High priority system notification (heads-up banner)
        NotificationHelper.showApprovalNotification(this, item);

        // Apple Siri-style half screen bottom sheet
        showSiriStyleBottomSheet(item);
    }

    @Override
    public void onApprovalExpired(String rid) {
        removeApproval(rid);
        NotificationHelper.cancelNotification(this, rid);
        Toast.makeText(this, "Request " + rid + " expired", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onAppsListReceived(List<AppItem> apps) {
        appList.clear();
        appList.addAll(apps);
        appsAdapter.notifyDataSetChanged();
        if (appList.isEmpty()) {
            tvEmptyApps.setVisibility(View.VISIBLE);
            rvApps.setVisibility(View.GONE);
        } else {
            tvEmptyApps.setVisibility(View.GONE);
            rvApps.setVisibility(View.VISIBLE);
        }
    }

    @Override
    public void onSystemStatsReceived(String statsText) {
        tvLaptopStats.setText(statsText);
    }

    @Override
    public void onScreenshotReceived(byte[] imageBytes) {
        pbScreenshotLoading.setVisibility(View.GONE);
        if (imageBytes != null && imageBytes.length > 0) {
            android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
            ivScreenshot.setImageBitmap(bitmap);
            ivScreenshot.setVisibility(View.VISIBLE);
            tvScreenshotTime.setText("Captured at " + new java.text.SimpleDateFormat("hh:mm:ss a", java.util.Locale.getDefault()).format(new java.util.Date()));
            Toast.makeText(this, "📸 Screen snapshot received!", Toast.LENGTH_SHORT).show();
        } else {
            tvScreenshotTime.setText("Failed to capture snapshot.");
        }
    }

    @Override
    public void onActionSuccess(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        bridgeClient.fetchRunningApps();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (bridgeClient != null) {
            bridgeClient.disconnect();
        }
    }
}

