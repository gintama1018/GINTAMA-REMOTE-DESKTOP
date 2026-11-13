# 04 · Threat Model

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-11-13 |
| **Method** | Asset and actor enumeration, STRIDE per component, abuse cases, residual-risk statement |

---

## 1. What we are protecting

| ID | Asset | Why it matters | Impact if compromised |
|---|---|---|---|
| AS-1 | Authority to approve agent commands on the laptop | Approval = code execution as the owner | Critical |
| AS-2 | Pairing and message keys, decision key | Forge or read approvals | Critical |
| AS-3 | Integrity of what the owner is shown | Approving something other than what runs | Critical |
| AS-4 | Command and workspace content (confidentiality) | Source code paths, secrets inside commands | High |
| AS-5 | Audit log | Evidence and detection | Medium |
| AS-6 | Relay operator secret / enrollment token | Registering rogue devices | High |
| AS-7 | Push token | Spam notifications | Low |
| AS-8 | Availability of the bridge | Convenience; failure must be safe | Low (by design) |

## 2. Actors

| ID | Actor | Capability |
|---|---|---|
| AC-1 | Internet attacker | No keys; can reach relay endpoints; can attempt flooding, enumeration |
| AC-2 | Compromised or malicious relay host | Full control of relay data and network position; can drop, delay, replay, reorder |
| AC-3 | Observer on the owner's networks | Passive/active network position (café, campus Wi-Fi) |
| AC-4 | Phone thief | Physical access, maybe screen lock known or shoulder-surfed |
| AC-5 | Same-user malware on laptop | Can read user files, processes, IPC |
| AC-6 | The agent itself, possibly prompt-injected | Chooses the command text; can attempt to disguise it or to cause fatigue |
| AC-7 | Google / FCM | Sees tokens, timing, push existence |
| AC-8 | Supply-chain attacker | Malicious dependency or build |
| AC-9 | Social engineer | Convinces the owner to approve or to pair a rogue device |

## 3. Security requirements

| ID | Requirement | Mitigates | Verified by |
|---|---|---|---|
| SEC-01 | End-to-end AEAD for all application messages; relay sees ciphertext only | T-01, T-03, T-04 | TC-S-11 |
| SEC-02 | Pairing requires QR secret plus SAS confirmation; tickets are single-use, ≤ 5 min | T-05, T-06 | TC-S-01..03 |
| SEC-03 | Monotonic `seq` per direction with persisted state; replays rejected | T-04 | TC-S-04 |
| SEC-04 | Digest binding computed independently on both ends; mismatch is a security event | T-07, T-08 | TC-S-05 |
| SEC-05 | `allow` requires a per-use user-authentication-bound signature verified by the desktop | T-10, T-11 | TC-S-07 |
| SEC-06 | Decisions are single-use and expire by desktop-authoritative deadline | T-09 | TC-S-06 |
| SEC-07 | Fail-safe: every error path resolves to defer-to-local, never allow (ADR-007) | T-12, T-13 | TC-C-* |
| SEC-08 | Remote actions limited to an enumerated registry; no shell, no unlock | T-14 | TC-S-10 |
| SEC-09 | Local deny-list evaluated before any notification | T-15 | TC-I-09 |
| SEC-10 | Revocation is immediate and enforced at relay and both ends | T-10, T-18 | TC-S-08 |
| SEC-11 | Keys at rest wrapped by OS/Keystore secure storage | T-10, T-16 | TC-S-14 |
| SEC-12 | Hash-chained audit log; verification command available | T-19 | TC-S-12 |
| SEC-13 | Relay holds no content and logs no content; push payload content-free | T-02, T-03 | TC-S-09, TC-S-13 |
| SEC-14 | Dependencies pinned, reproducible builds as far as practical, no unreviewed crypto | T-20 | process, doc 09 |

## 4. STRIDE analysis

### 4.1 Relay (C3)

| ID | STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|---|
| T-01 | I | Relay operator reads approvals | SEC-01 | Metadata visible (ids, timing, size); accepted |
| T-02 | I | Relay logs leak sensitive data | SEC-13, NFR-08 | Operator error; log scrubbing tests |
| T-03 | T | Relay modifies ciphertext | AEAD + AAD (SEC-01) | None beyond DoS |
| T-04 | R/T | Relay replays or reorders messages | `seq` + AAD (SEC-03) | DoS by dropping |
| T-21 | D | Flooding the relay | Rate limits, queue caps, auth before queue | Provider-level DDoS out of scope |
| T-22 | S | Rogue device registers on the relay | Operator enrollment token + tickets (ADR-011) | Token theft → revoke and rotate |
| T-23 | E | Relay vulnerability gives host takeover | Minimal surface, containerised, no secrets of value on host | Patch discipline |

### 4.2 Pairing

| ID | STRIDE | Threat | Mitigation |
|---|---|---|---|
| T-05 | S | MITM during pairing (relay or network) | PSK in QR (out-of-band) + SAS confirmation (SEC-02) |
| T-06 | S | QR photographed/shoulder-surfed | 5-min expiry, single use, SAS still required; user sees the desktop prompt for pairing; rate-limited redeem |
| T-24 | S | Social engineering: owner scans attacker's QR | Phone shows desktop fingerprint and device name before SAS; pairing only from desktop-initiated flow; wrong desktop key → abort |

### 4.3 Approval path

| ID | STRIDE | Threat | Mitigation |
|---|---|---|---|
| T-07 | T | Displayed command differs from executed command | Digest computed independently from displayed data, compared to the original (SEC-04) |
| T-08 | T | Agent changes arguments after approval | Hook input is the executed call; `overwrite` is never used (doc 06 §3.4); digest covers args |
| T-09 | R/T | Late or replayed decision applied to a different request | Single-use, deadline, `rid`-bound digest (SEC-06) |
| T-10 | S/E | Forged or stolen-key decision | AEAD key + per-use biometric signature (SEC-05); keys wrapped (SEC-11); revoke (SEC-10) |
| T-11 | E | Thief with unlocked phone approves | Per-use auth required; lock-screen notifications hide content; revoke from laptop. **Residual:** coerced owner or defeated biometric |
| T-12 | D | Bridge down causes unsafe auto-approval | Fail-safe defer (SEC-07). Verified by FMEA |
| T-13 | T | Hook returns malformed output | Hook always returns valid JSON; Antigravity behaviour on malformed output to be verified (S-04) |
| T-25 | S | Spoofed push "Approval needed" | Push is content-free; app only acts on authenticated, decrypted relay data |

### 4.4 Desktop and local

| ID | STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|---|
| T-14 | E | Remote action abuse (arbitrary exec, unlock) | Registry only; lock/status only (SEC-08, ADR-008) | None by design |
| T-15 | E | Dangerous command approved by habit | Local deny-list, risk tiers, full-command display, friction on high tier (ADR-009) | Human factor (R-05) |
| T-16 | I | Keys read from disk | OS secure storage (SEC-11) | Same-user malware can use OS APIs (T-26) |
| T-26 | E | Same-user malware talks to local IPC or edits `hooks.json` | IPC user-only ACL + token; it already has user-level code execution | **Accepted out of scope**: bridge does not expand that attacker's power, but cannot defend against it (R-09). We do audit `hooks.json` integrity on agent start and alert on change |
| T-19 | T | Audit log tampering | Hash chain (SEC-12) | Attacker with full local control can truncate; phone copies provide a cross-check |
| T-27 | I | Command text leaks into agent-visible `reason` on deny | Reason is a fixed neutral string | None |

### 4.5 Phone

| ID | STRIDE | Threat | Mitigation |
|---|---|---|---|
| T-17 | I | Device compromise reveals message keys (no forward secrecy in v1) | Keystore wrapping, revoke + re-pair; rekey in Phase 4 |
| T-18 | E | Lost phone retains access | Revoke from desktop; desktop "panic revoke all"; relay enforces |
| T-28 | I | Notification content visible on lock screen | Private visibility; generic text until unlock |
| T-29 | T | Malicious app overlays approve button | Allow requires OS biometric prompt on a secure surface plus signed digest; app sets window flags against overlays/screenshots on the approval screen [verify in M3] |

### 4.6 Build and supply chain

| ID | STRIDE | Threat | Mitigation |
|---|---|---|---|
| T-20 | T | Malicious dependency | Pin versions and hashes, minimal dependency set, review crypto-adjacent updates, SBOM per release |
| T-30 | S | Tampered APK distributed | Self-signed release key held offline, checksum published to the owner's own channel; sideloading only |

## 5. Abuse cases

| ID | Abuse case | Walkthrough | Controls |
|---|---|---|---|
| AB-1 | **Prompt-injected agent crafts a lookalike command.** A poisoned README makes the agent propose a command whose visible start looks benign but which chains something harmful. | Phone shows the **whole** command in a monospace block, highlights chaining/redirect/pipe/substitution characters, shows tier 3, requires hold-to-confirm and biometric. Deny-list auto-blocks known-destructive patterns. | FR-03, FR-12, ADR-009 |
| AB-2 | **Approval fatigue.** Many low-risk approvals train reflexive tapping. | Tiering so low-risk can be handled by the owner's local allow rules rather than phone; volume and time-to-approve tracked; per-conversation caps. | R-05, FR-12 |
| AB-3 | **Swarm flood.** Subagents generate dozens of requests. | Per-conversation cap, excess defers locally, queue cap. | §10 of doc 02 |
| AB-4 | **Relay takeover.** Attacker owns the relay and tries to approve. | Cannot forge AEAD or signature; can only drop/delay. Desktop defers on timeout. | SEC-01, SEC-05, SEC-07 |
| AB-5 | **Stolen unlocked phone.** | Per-use biometric; revoke; `allow` signature missing → rejected. | SEC-05, SEC-10 |
| AB-6 | **Replay of an old Allow.** | `seq`, single-use, deadline, digest. | SEC-03, SEC-06 |
| AB-7 | **Rogue second phone pairing.** | Pairing is desktop-initiated, needs QR+SAS, and v1 caps paired phones at one (A-02). | SEC-02 |

## 6. Data classification

| Data | Class | At rest | In transit | Retention |
|---|---|---|---|---|
| Command text, args, cwd | Confidential | Desktop audit log (local); phone history (encrypted app storage) | E2E sealed | Configurable, default 30 days on phone, audit local until deleted by owner |
| Keys | Secret | OS secure store / Keystore | Never transmitted (only public keys) | Until revoke |
| Device ids, push token | Internal | Relay DB | TLS | Until revoke + 30 d |
| Metadata (timing, sizes) | Internal | Relay metrics | TLS | 14 days aggregated |

## 7. Residual risk statement

Accepted after mitigation: relay metadata exposure; no forward secrecy against later device-key compromise (v1); same-user malware on the laptop; coerced or fatigued human; Google seeing push timing. Anything outside this list that is discovered later is a defect against this document.

## 8. Security review gates

1. Before M1 exit: protocol and crypto review against doc 03, with test vectors (TC-U-01..05).
2. Before M3 exit: biometric/Keystore flow review (SEC-05, T-29).
3. Before MVP exit: full TC-S-* pass and a manual penetration pass of the relay (auth bypass, queue abuse, injection).
4. On every Antigravity version bump: re-run S-01/S-04 contract tests (R-03).