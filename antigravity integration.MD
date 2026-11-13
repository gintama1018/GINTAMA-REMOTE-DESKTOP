# 06 · Antigravity Integration Specification

| | |
|---|---|
| **Status** | Draft v0.1. **Feasibility is not yet proven.** Spikes S-01..S-04 gate the whole design |
| **Date** | 2026-11-13 |
| **Fetched sources** | Official docs pages fetched 2026-11-13 (listed in §2) |

This is the document that decides whether the project is buildable. Everything that rests on a guess is labelled and has a spike attached.

---

## 1. Purpose

Define exactly how Bridge attaches to Antigravity, what is **documented**, what is **only claimed by third parties**, and what is **unknown and must be measured**.

## 2. Sources and confidence

| Label | Meaning | Sources |
|---|---|---|
| **[V-DOC]** | Stated in Google's official Antigravity documentation or the official CLI repository changelog | Hooks: `https://antigravity.google/docs/hooks` · Permissions: `https://antigravity.google/docs/permissions/` · ACP: `https://antigravity.google/docs/cli/acp/` and `https://antigravity.google/docs/ide/extensions/acp/` · CLI changelog: `https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md` (search excerpt) |
| **[V-3P]** | Stated by a third party; not authoritative; may be outdated | Practitioner article on hook-based permission policy (tested CLI `agy` 1.4.5 and desktop app 2.25.0): `https://medium.com/google-cloud/stop-clicking-yes-shipping-an-agent-permission-policy-inside-the-repository-with-google-eb434885ec00` · A third-party hook integration crate documenting Antigravity CLI hook decisions (tested against CLI 1.1.2): `https://docs.rs/safe-chains/latest/safe_chains/targets/agy/index.html` |
| **[SPIKE-n]** | Unknown; measure before relying | §7 |

Antigravity changes quickly (the CLI changelog shows hook-related behaviour changes in recent minor versions). Treat every statement here as valid for the versions in §8 only.

## 3. Hook contract (documented)

### 3.1 Availability and configuration [V-DOC]

* Hooks are available in the Antigravity **App, CLI and IDE**.
* Config file: `hooks.json`. Workspace level: `.agents/hooks.json`. Global level: `~/.gemini/config/hooks.json`. CLI additionally supports plugin-level hooks; hooks in the CLI `settings.json` are **not** loaded.
* Top-level keys are **hook names**; each may have `enabled` (boolean, default true) and event keys.
* Events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`.
* For tool events, `matcher` is a regular expression on the tool name (`""`/`"*"` all; `"run_command"`; alternation; prefix wildcard).
* Handler fields: `type` (only `"command"`), `command` (required), `timeout` (integer seconds, **default 30**).

### 3.2 Input and output [V-DOC]

* Input: JSON on stdin, camelCase. Common fields: `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`, `lastUserInput`.
* `PreToolUse` input adds `toolCall.name`, `toolCall.args`, `stepIdx`.
* `run_command` args: `CommandLine`, `Cwd`, `WaitMsBeforeAsync`, optional `RunPersistent`, `RequestedTerminalID`.
* Output: JSON on stdout with `decision` (**required**), optional `reason`, `overwrite`, `permissionOverrides`.
* The official CLI changelog states that later CLI versions also provide `hookEventName`, `cwd` and `toolCall.id` in hook input [V-DOC]. **Our parser MUST tolerate unknown and optional fields** and never depend on those three.

### 3.3 Decision semantics [V-DOC]

| Decision | Documented meaning | Bridge use |
|---|---|---|
| `allow` | Proceed, delegating to the next hook or default policy | **Defer / pass-through** (no opinion) |
| `auto_approve` | Approves when the default policy would otherwise prompt, **while honouring explicit user-configured rules** | Phone **Allow** |
| `deny` | Hard block | Phone **Deny**, local deny-list match |
| `ask` | Prompt, respecting "Always Allow" | Not used |
| `force_ask` | Always prompt, ignoring cached permissions | Optional for tier-3 commands the owner wants always confirmed locally (never when phone has approved) |
| `deny_unless_prior_grant` | Deny unless previously granted | Not used |

Mapping used throughout the design: `defer → allow`, `phone allow → auto_approve`, `phone deny → deny`.

### 3.4 What we deliberately do not use

* `overwrite` (rewrites tool args). If we modified arguments, the approved digest would no longer describe what runs (T-08). Never emitted.
* `permissionOverrides`. Would let a decision widen future permissions; excluded to avoid creating persistent privilege (NG-5).
* Hooks on events other than `PreToolUse` in v1 (a `PostToolUse` hook for auditing results is an optional later addition).

## 4. Permission model facts [V-DOC unless noted]

* **App presets**: *Request Review* (sandbox off; terminal commands always ask; workspace-only files; MCP/web ask), *Default* (sandbox on; sandboxed commands run without prompt; outside-sandbox ask), *Auto* (sandbox on; out-of-sandbox commands evaluated automatically; risky ones ask), *Turbo* (sandbox off; unrestricted, full filesystem). Auto availability and enterprise limits are version/account dependent.
* **Rules**: Deny, Ask, Allow lists; precedence **Deny > Ask > Allow**; rules sit on top of the preset and always win over it. Actions include `read_file`, `write_file`, `read_url`, `execute_url`, `download_url`, `command`, `mcp`.
* **CLI**: `toolPermission` policies `request-review`, `proceed-in-sandbox`, `strict`, `always-proceed` (via `--dangerously-skip-permissions`) and agent modes `default`, `accept-edits`, `auto`; configured in `~/.gemini/antigravity-cli/settings.json`.
* **The permissions page does not mention hooks at all.** It does not say whether `auto_approve` can suppress a prompt under any preset.

### 4.1 Conflicting evidence on the central question

| Claim | Source | Implication |
|---|---|---|
| `auto_approve` approves when default policy would prompt, honouring explicit rules | [V-DOC] hooks | Under a preset (not an explicit rule), it should work |
| `auto_approve` cannot override an explicit ask rule, and the *Require review* terminal setting behaves like a rule that asks for every command; `allow` is a no-op | [V-3P] (CLI 1.4.5, app 2.25.0) | Under Request Review, phone approval may **not** suppress the local prompt |
| An admin-enforced review is no longer bypassed by hook `auto_approve` | [V-DOC] CLI changelog (1.5.7) | Enterprise policies can veto the design |
| A third party saw CLI 1.1.2 ignore `allow` for skipping its own confirmation, and fail closed on malformed decisions | [V-3P] | Old behaviour; verify on current versions |

**Conclusion:** the idea is plausible on paper and unproven in practice. This is S-01.

## 5. ACP mode facts [V-DOC]

* `agy acp` runs the CLI agent as an **Agent Client Protocol server**: JSON-RPC over stdin/stdout, launched by an editor/client.
* Permission requests are shown by the **client**, with exactly two answers, **Allow** and **Deny**; a pending request pauses the turn; cancelling abandons pending requests.
* Existing permission rules still apply (already-allowed or denied actions do not prompt).
* Flags include `--sandbox`, `--dangerously-skip-permissions`, `--add-dir`, `--agent`, `--process-per-session`, `--log-file`.
* The docs **do not say** whether lifecycle hooks or presets apply in ACP mode.
* This is the documented alternative integration (ADR-001 option B): the desktop agent would act as the ACP client and own the permission prompt natively, with no dependency on hook-decision semantics. Cost: sessions are driven through our client, not through the Antigravity IDE UI.

## 6. Integration design

### 6.1 Hook entry

A single named hook (e.g. `remote-bridge`) under the **global** `hooks.json` by default (so it covers App, CLI and IDE, S-06), with:

* event `PreToolUse`, matcher `run_command` in v1 (broaden only after S-03),
* handler `command` = the hook client invocation,
* explicit `timeout` = H from doc 05 §4.4 (never rely on the 30 s default).

### 6.2 Installer rules (all MUST)

1. Read existing `hooks.json`; if unparsable, **stop** and tell the owner (never overwrite).
2. Back up the file with a timestamp before any change.
3. Merge: add or replace only the `remote-bridge` key; preserve all other hooks byte-for-byte semantically.
4. Validate the resulting JSON before writing; write atomically (temp file + rename).
5. Record a hash of the written entry so the agent can detect external change (F-25).
6. Uninstall removes only our key.
7. Never edit permission settings (presets, rules). Changing the owner's safety configuration is out of the installer's remit.

### 6.3 Runtime behaviour of the hook client

* Reads stdin fully, parses leniently, builds a normalised call (doc 02 §8.1), calls the agent over IPC.
* Applies an internal hard deadline D (doc 05 §4.4); on deadline, IPC failure or any exception, prints a **valid defer document** (`allow` decision) and exits 0.
* Output JSON is built from a fixed template; no command text ever appears in `reason`.
* Cold-start budget NFR-06 (S-10).

### 6.4 Coverage

Only prompts that pass through `PreToolUse` for the matched tools are visible to Bridge. Prompts for file access outside the workspace, MCP calls, web access, or `ask_permission` may or may not pass through hooks (S-03). Until measured, the product MUST state in-app: "Bridge covers commands. Other prompts still appear on the laptop."

## 7. Spikes (feasibility gates)

Each spike is a time-boxed experiment with a pass/fail criterion. A throwaway **probe hook** (logs stdin to a file, then returns a configured decision after a configured delay) is the shared tool; it is test equipment, not product code. Use a scratch workspace and harmless commands only.

### S-01 · Does `auto_approve` suppress the local prompt?

| | |
|---|---|
| **Question** | In which surface × permission mode does a hook returning each decision actually change the outcome? |
| **Matrix** | Surface (App / IDE / CLI, per Q-03) × mode (App: Request Review, Default, Auto, Turbo; CLI: request-review, proceed-in-sandbox, strict, auto) × decision (`allow`, `auto_approve`, `ask`, `force_ask`, `deny`) × command class (in-sandbox benign, needs-network benign, writes outside workspace benign) |
| **Observe** | Did a local prompt appear? Did the command run? Latency? Any UI warning? |
| **Pass** | At least one configuration, on the surface the owner actually uses, that is **not** Turbo/always-proceed, where `auto_approve` runs a command that would otherwise prompt **without** any local prompt, and `deny` blocks it |
| **Fail consequence** | Hook-based approval cannot work on the owner's preferred surface → go to the pivot options in doc 09 §4 (ACP, or a different permission mode) |
| **Effort** | 0.5–1 day |

### S-02 · Hook blocking limits and cancel behaviour

| | |
|---|---|
| **Questions** | Maximum accepted `timeout`; what happens at timeout (fail closed / open / local prompt); whether a blocked hook freezes the agent loop or only that tool call; whether parallel tool calls/subagents can be blocked simultaneously; **what happens to the hook process when the owner presses Stop or closes the window** (signal? stdin closed? orphan?) |
| **Method** | Probe hook with delays of 10 s, 60 s, 300 s, 900 s, 3600 s and timeout values spanning the same; two concurrent agents; cancel mid-wait while logging signals and process lifetime |
| **Pass** | H_max ≥ 320 s (T = 300 s plus margin) **or** a documented behaviour at timeout that is safe (falls to local prompt), and cancellation is detectable by the hook (so F-07/R-15 can be handled) |
| **Fail consequence** | Reduce T to H_max − 20 s; if cancel is undetectable, add a stale-request sweeper and accept possible orphan phone prompts |
| **Effort** | 0.5–1 day |

### S-03 · Coverage of prompts

| **Question** | Which prompt types reach `PreToolUse` (run_command, write_to_file outside workspace, replace/multi-replace edits, MCP calls, `read_url_content`, `ask_permission`, browser tools)? |
|---|---|
| **Method** | Probe hook with matcher `*`; trigger each kind in each preset; record which invoke the hook and whether the local prompt fires before/after |
| **Pass** | `run_command` covered everywhere used; others documented |
| **Fail consequence** | Narrow product claims (6.4); consider ACP for full coverage |
| **Effort** | 0.5 day |

### S-04 · Hook failure behaviour

| **Question** | What does the host do on non-zero exit, empty stdout, invalid JSON, unknown decision string, oversized output, crash, slow start, timeout? |
|---|---|
| **Method** | Probe hook emitting each failure mode |
| **Pass** | Each failure maps to a known behaviour; ideally fail-closed or local prompt, **never silent execution** |
| **Fail consequence** | If any failure executes the command unprompted, the hook must be made un-failable (self-check, minimal template) and the owner warned |
| **Effort** | 0.5 day |

### S-05 · Push delivery on the owner's phone

| **Question** | FCM high-priority data message latency and reliability under screen-off, Doze, battery saver, app swiped away (not force-stopped), and the vendor's battery manager |
|---|---|
| **Method** | 100 samples across states; measure send→notification-posted |
| **Pass** | p95 ≤ 15 s and ≥ 99 % delivered within 300 s when not force-stopped |
| **Fail consequence** | Add foreground-service socket option, onboarding for battery exemptions, or UnifiedPush; revisit NFR-02 |
| **Effort** | 1 day (+ passive collection) |

### S-06 · `hooks.json` scope, reload and multi-hook behaviour

| **Questions** | Does a global entry cover App, CLI and IDE? Is the file hot-reloaded? How do multiple hooks combine when decisions differ (owner's own safety hook + ours)? Do workspace hooks override or add? |
|---|---|
| **Pass** | Deterministic documented-by-experiment combination; global entry covers the owner's surface |
| **Fail consequence** | Per-workspace installs; document conflicts; order hooks explicitly |
| **Effort** | 0.5 day |

### S-07 · Crypto library viability

| **Question** | Maintained, audited libraries on Android and on the desktop language for X25519, Ed25519, XChaCha20-Poly1305, HKDF-SHA-256, Noise XXpsk3, and Keystore capabilities (per-use auth ECDSA P-256, StrongBox presence on the owner's phone) |
|---|---|
| **Pass** | All primitives available from vetted libraries; shared test vectors pass on both sides |
| **Fail consequence** | Use documented fallback (doc 03 §4.1), re-review |
| **Effort** | 1 day |

### S-08 · Network traversal

| **Question** | Does outbound WSS on 443 work, and how long are idle connections kept, on the owner's real networks (home ISP, campus Wi-Fi, mobile hotspot)? |
|---|---|
| **Pass** | Connects everywhere tested; keepalive interval derived with margin |
| **Fail consequence** | Add HTTPS long-poll fallback (OD-5) |
| **Effort** | 0.5 day |

### S-09 · Presence and lock-state detection

| **Question** | Accuracy of idle-time and session-lock detection on the owner's OS |
|---|---|
| **Pass** | Detects "user active" within 2 s, "locked" reliably |
| **Fail consequence** | Make FR-17 opt-out; rely on TTL |
| **Effort** | 0.5 day |

### S-10 · Hook cold-start latency

| **Question** | Time from Antigravity invoking the hook to pass-through output, for candidate implementation languages, when the agent is down |
|---|---|
| **Pass** | ≤ 150 ms (NFR-06) |
| **Fail consequence** | Switch hook to a compiled single binary |
| **Effort** | 0.25 day |

## 8. Compatibility matrix (to be filled by spikes)

| Surface | Version tested | S-01 | S-02 | S-03 | S-04 | S-06 | Status |
|---|---|---|---|---|---|---|---|
| App | _to record_ | | | | | | |
| IDE | _to record_ | | | | | | |
| CLI (`agy`) | _to record_ | | | | | | |

Contract tests (TC-I-15) re-run S-01 and S-04 scenarios automatically on each Antigravity update the owner installs. Bridge refuses to route (defers all) on a surface/version it has not been validated against, until the owner opts in (F-26).

## 9. Known unknowns not covered by a spike

* Whether Antigravity's own "Remote Control" feature interacts with hooks. Out of scope by owner decision; noted only because it may share permission plumbing.
* Enterprise/organisation-managed policies that block hooks (changelog 1.5.7 suggests such policies exist). Applies only if the owner's account is managed.
* Hook behaviour for remote or cloud-hosted agent sessions (A-07 assumes local).