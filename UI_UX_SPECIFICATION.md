# Bridge Remote · Mobile UI/UX Design Specification

| | |
|---|---|
| **Product** | Bridge Remote Companion (Mobile APK) |
| **Target Platforms** | Android (Phone / Foldable) |
| **Design Language** | Dark Cyber-Minimalism / Slate & Glassmorphism |
| **Primary Theme** | Dark Mode Exclusive (`#0F172A` background) |
| **Target User** | AI Software Developer / Power Operator |

---

## 1. Design System Tokens

### 1.1 Color Palette
* **Canvas Background (`bg_canvas`):** `#0F172A` (Deep Slate Navy)
* **Surface / Card Background (`bg_surface`):** `#1E293B` (Elevated Slate)
* **Code Editor / Terminal Box (`bg_code`):** `#0B1120` (Pitch Black Navy)
* **Borders / Separators (`border_subtle`):** `#334155` (Muted Steel)
* **Primary Accent (`accent_primary`):** `#3B82F6` (Electric Blue)
* **Success / Allow (`color_allow`):** `#10B981` (Vibrant Emerald Green)
* **Destructive / Deny / Kill (`color_deny`):** `#EF4444` (Coral Red)
* **Code Syntax Highlighting:** `#38BDF8` (Cyan Blue)
* **Text Primary (`text_primary`):** `#F8FAFC` (Pure Off-White, 100% opacity)
* **Text Secondary (`text_secondary`):** `#94A3B8` (Cool Grey, 70% opacity)
* **Status Online Pill:** `#10B981` (Green pulse)
* **Status Offline Pill:** `#EF4444` (Red)

### 1.2 Typography
* **UI Font Family:** Inter / Roboto / SF Pro Display
* **Code / Terminal Font Family:** JetBrains Mono / Fira Code / Android Monospace
* **Scale:**
  * Title Large: `20sp` Bold
  * Section Header: `17sp` SemiBold
  * Card Header / App Title: `15sp` SemiBold
  * Body Text: `14sp` Regular
  * Code Text: `13sp` Monospace
  * Metadata / Badges / Subtitles: `11sp` - `12sp` Medium

### 1.3 Geometry & Radii
* Modal Bottom Sheet Top Corners: `24dp`
* Standard Cards: `12dp` - `16dp`
* Action Buttons: `8dp` - `10dp`
* Badges / Status Pills: `12dp` (Full pill shape)
* Top Drag Handle Pill: `40dp` width × `4dp` height, `#475569`

---

## 2. Navigation Architecture & Global Shell

```
┌────────────────────────────────────────────────────────┐
│ [Bridge Remote]                          [● Online]    │ ◄── Persistent Top Bar
├────────────────────────────────────────────────────────┤
│                                                        │
│                                                        │
│                    ACTIVE PAGE CONTENT                 │
│                                                        │
│                                                        │
├────────────────────────────────────────────────────────┤
│   [⚡ Approvals]   [📱 Apps]   [🎮 Controls]  [⚙️ Settings] │ ◄── Persistent Bottom Nav
└────────────────────────────────────────────────────────┘
```

### Global Elements:
1. **Persistent Top Bar:**
   * **Left:** App Title "Bridge Remote" with subtle gradient or glowing dot.
   * **Right:** Connection Status Badge.
     * Connected: `● Online` with glowing emerald background `#064E3B` and green text `#10B981`.
     * Disconnected: `● Offline` with muted red `#7F1D1D` and coral text `#EF4444`.
2. **Persistent Bottom Navigation Bar:**
   * Height: `64dp` with frosted glass / surface blur.
   * 4 Tabs with haptic click feedback:
     1. `Approvals` (Lightning bolt / shield icon)
     2. `Apps` (Layers / application window icon)
     3. `Controls` (Lock / gamepad controller icon)
     4. `Settings` (Sliders / gear icon)

---

## 3. Screen-by-Screen UI/UX Specifications

---

### SCREEN 1: "Approvals" (The AI Agent Permission Feed)

#### Purpose:
Displays all real-time permission requests arriving from Antigravity agents running on the laptop.

#### Key States:
1. **Empty State (Default):**
   * Centered illustration (sleeping robot / checkmark shield).
   * Headline: *"All Quiet & Running"*
   * Subtitle: *"Antigravity hasn't requested any permissions. Your AI agent is working autonomously."*
2. **Populated State (List of Cards):**
   * Scrollable cards ordered by newest first.
   * Visual components per Card:
     * **Tool Badge:** Cyan/Blue pill showing tool name (e.g. `run_command`, `write_file`).
     * **Request ID:** Muted label (e.g. `ID: req_8f21bc`).
     * **Command Snippet Box:** Pitch-black background `#0B1120` with bright cyan monospace font. Shows exact terminal command. Horizontally scrollable if long.
     * **Directory Subtitle:** Folder icon + Working Directory path on laptop (`C:\Users\hp\Downloads\...`).
     * **Split Action Footer:**
       * Red `[Deny]` button (40% width).
       * Green `[Allow (Biometric)]` button with fingerprint icon (60% width).

---

### SCREEN 2: The "Siri-Style" Dynamic Half-Screen Modal (Bottom Sheet)

#### Trigger:
* Automatically slides up when tapping a push notification from outside the app.
* Or slides up instantly in-app when a new permission request arrives.

#### Visual Hierarchy:
```
┌────────────────────────────────────────────────────────┐
│                       ══════                           │ ◄── Top drag handle (40x4dp)
│  ⚡ Agent Permission Request            [run_command]   │ ◄── Header & Tool Badge
│  ID: req_9a12cf4                                       │
│                                                        │
│  COMMAND:                                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ npm run build && git commit -m "update"          │  │ ◄── Dark Monospace Block
│  └──────────────────────────────────────────────────┘  │
│  📂 Directory: C:\Users\hp\project\web                 │
│                                                        │
│  ┌───────────────┐  ┌───────────────────────────────┐  │
│  │   Deny ✕      │  │    Allow (Fingerprint) 👆     │  │ ◄── Big Touch Targets
│  └───────────────┘  └───────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

#### Micro-Interactions:
* **Drag-to-Dismiss:** Swipe down on the handle dismisses the sheet (without deciding; request remains in the queue).
* **Tap Allow:**
  1. Haptic tick.
  2. Android OS Biometric prompt (`BiometricPrompt`) smoothly overlays.
  3. On successful fingerprint match: Sheet slides down with success sound, green notification toast shows *"🟢 Approved on Laptop"*.
* **Tap Deny:**
  1. Instant haptic double-buzz.
  2. Sheet slides down, Red toast shows *"🔴 Blocked Agent Command"*.

---

### SCREEN 3: "Active Apps" (Laptop Task Manager)

#### Purpose:
Inspect and manage running desktop applications on the laptop.

#### Layout:
1. **Header Row:**
   * Left: Title *"Active Applications (Laptop)"* + Count Badge (e.g. `5 Open Apps`).
   * Right: Pill Button `[ ↻ Refresh ]` with rotating icon animation while fetching.
2. **Process Cards List:**
   * Each card represents one user-facing desktop application:
     * **App Icon / Initials Avatar:** Generic program icon or colored circle.
     * **Application Name:** Bold title (e.g. `Google Chrome`, `Antigravity IDE`, `Blender`).
     * **Window Title:** Muted italic text showing what is currently open inside the app (e.g. `YouTube - Google Chrome`).
     * **Process ID (PID) & RAM Usage Badge:** Dark badge showing `PID: 14208 | 480 MB RAM`.
     * **Action Buttons:**
       * `[ Close ]` (Outlined Button): Sends gentle `WM_CLOSE` to gracefully quit.
       * `[ End Task ]` (Text Button, Red): Force terminates (`taskkill /F`) if frozen.

---

### SCREEN 4: "Controls" (Security, Screen Snapshot & Hardware Health)

#### Layout:
Scrollable dashboard with 3 primary functional sections:

#### Section 1: Security Controls (Top Card)
* Headline: `🔒 Security Action`
* Description: *"Instantly lock your laptop screen from anywhere over the internet."*
* Big Red Button: `[ 🔒 Lock Laptop Screen ]`
  * Tap feedback: Confirmatory haptic pulse + Toast *"Laptop screen locked"*.

#### Section 2: Remote Screen View (Middle Card - Feature #1)
* Header: `📸 Remote Screen Snapshot` + Button `[ Capture ]`.
* Description text: *"Tap Capture to view a live 720p snapshot of your desktop."*
* **Interactive Image Container (`ImageView`):**
  * Aspect Ratio: 16:9 widescreen.
  * Border: `#334155`, background pitch black.
  * Loading State: Centered smooth circular spinner.
  * Loaded State: Displays the 20 KB compressed screenshot of the Windows desktop.
  * Timestamp Footer: *"Captured at 04:22:15 PM"*.
  * Interaction: Tapping the image opens it full-screen with pinch-to-zoom!

#### Section 3: Hardware Health & Telemetry (Bottom Card)
* Header: `💻 Laptop Telemetry` + Link Button `[ Update ]`.
* Metric Rows (Grid or Clean Key-Value List):
  * 🔋 **Battery Level:** Horizontal battery progress bar + percentage (`100% ⚡ Charging` or `84% on Battery`).
  * 🧠 **RAM Consumption:** Gauge bar showing `Used: 11.8 GB / Total: 16.0 GB (74%)`.
  * ⚙️ **CPU Cores:** `8 Cores (Intel / AMD)`.
  * ⏱️ **System Uptime:** `18 Hours, 42 Minutes`.

---

### SCREEN 5: "Settings" (Permanent Host Configuration)

#### Layout:
1. **Relay Server Input:**
   * Text Input field with Material Outline:
     * Label: `Relay Host / Public Domain`
     * Pre-filled value: `gintamaremotedesktop.duckdns.org:8765` or `192.168.1.13:8765`.
     * Helper note: *"Supports local IP, DuckDNS, or cloud tunnel URL."*
2. **Action Button:**
   * Big Electric Blue Button: `[ Save & Connect ]`.
   * Stored in `SharedPreferences` so it is permanently remembered across app reboots.
3. **Connection Diagnostics:**
   * Device ID: `dev_phone_01` (Fixed).
   * Peer Target: `dev_laptop_01`.
   * Protocol Version: `v1.0 (XChaCha20 / E2E Sealed)`.

---

### SCREEN 6: System Notification Banner (Heads-Up Display)

#### Appearance on Lock Screen & Notification Drawer:
* **Icon:** Shield / Alert icon with high-contrast accent.
* **Title:** `⚠️ Permission Needed: run_command`
* **Body:** Preview of command: `npm test`
* **Expandable BigText:** Displays full command and directory.
* **Notification Action Buttons (Direct Taps):**
  * `[ ✕ Deny ]`
  * `[ ✓ Allow ]`
* **Clicking the Notification Body:** Directly launches the app and triggers the **Siri-Style Half-Screen Bottom Sheet**.

