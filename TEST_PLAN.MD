# 08 · Test Plan

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-11-13 |
| **Principle** | Every requirement and every failure mode has at least one test; safety-critical paths (NFR-03) get adversarial tests |

---

## 1. Strategy

| Layer | Purpose | Environment |
|---|---|---|
| **U** Unit and vector | Pure logic and crypto vectors, state machines, policy matchers | CI |
| **I** Integration | Components together, with a scripted fake Antigravity hook caller and a fake FCM | CI + local |
| **C** Chaos/fault | Inject failures from the FMEA (doc 05 §3) | Local/CI with fault injection proxy |
| **S** Security | Active attacks from doc 04 | Local + manual pen pass |
| **P** Performance | Latency, footprint | Real devices and networks |
| **D** Device | Android/OEM/Doze/battery behaviour | Real phone(s) |
| **A** Acceptance | End-to-end with real Antigravity | Owner's environment |

Rule: a defect found in S or C layers adds a regression test at the lowest layer that can reproduce it.

## 2. Test environments

* **Fake hook caller**: replays recorded `PreToolUse` JSON into the hook client. Fixtures captured during S-01..S-04.
* **Fault-injecting relay proxy**: drop, delay, duplicate, reorder, close, throttle.
* **Clock control**: ability to step wall time and freeze monotonic time in tests.
* **Real Antigravity**: pinned versions per compatibility matrix (doc 06 §8) for A-tests and TC-I-15.

## 3. Test cases

### 3.1 Unit and vectors

| ID | Case |
|---|---|
| TC-U-01 | Canonical digest vectors (JCS ordering, unicode, large args); identical results on desktop and phone |
| TC-U-02 | HKDF label derivations match published vectors |
| TC-U-03 | AEAD seal/open with fixed nonce vectors; tamper any byte of ct/AAD → fail |
| TC-U-04 | SAS derivation vectors; 6-digit rendering, leading zeros |
| TC-U-05 | `seq` persistence: strictly-greater rule, crash-resume ≥ persisted |
| TC-U-06 | Request state machine: all transitions, invariants I-1..I-4 (property-based) |
| TC-U-07 | Backoff calculator: bounds, jitter distribution, reset rule |
| TC-U-08 | Policy matcher: deny patterns, tier assignment, metacharacter detection |
| TC-U-09 | Hook decision mapping defer→allow, allow→auto_approve, deny→deny; **no input yields auto_approve without verified Allow** |

### 3.2 Integration

| ID | Case |
|---|---|
| TC-I-01 | Pairing happy path produces matching keys and SAS |
| TC-I-02 | Relay challenge-response; unknown device rejected (BR-1002); relay DB loss path (F-27) |
| TC-I-03 | Reconnect after transport drop restores presence |
| TC-I-04 | Phone outbox retries and survives process restart |
| TC-I-05 | Relay never delivers after TTL |
| TC-I-06 | Second connection displaces first; ordering preserved |
| TC-I-07 | 8 KiB command renders in full, no truncation; 64 KiB+ rejected with BR-5003 |
| TC-I-08 | Five parallel requests resolve independently |
| TC-I-09 | Deny-list match denied without notification; tier shown for others |
| TC-I-10 | Local input during pending wait → defer ≤ 2 s |
| TC-I-11 | Offline detection ≤ 90 s; presence debounce |
| TC-I-12 | Lock action executes ≤ 5 s on connected pair |
| TC-I-13 | Audit chain verifies; every transition present before hook answered |
| TC-I-14 | N-1 protocol compatibility accepted; N-2 refused with BR-7001 |
| TC-I-15 | Antigravity contract tests: re-run S-01 and S-04 scenarios per supported surface/version |

### 3.3 Chaos / fault injection

| ID | Case | FMEA |
|---|---|---|
| TC-C-01 | Kill desktop agent mid-request; hook defers, no hang | F-05, F-06 |
| TC-C-02 | TTL expiry yields defer, phone shows Expired | F-10 |
| TC-C-03 | Relay down at request time → immediate defer | F-01 |
| TC-C-04 | Relay drops mid-decision; outbox delivers or request expires safely | F-02, F-19 |
| TC-C-05 | Duplicate envelope delivery; effect exactly once | F-11 |
| TC-C-06 | Reordered/replayed envelopes dropped, audited | F-12 |
| TC-C-07 | Wall-clock step ±1 h; deadlines unaffected | F-20 |
| TC-C-08 | Kill phone app between tap and send; decision still delivered | F-21 |
| TC-C-09 | Lock request older than validity is discarded | |
| TC-C-10 | Laptop sleep mid-request | F-18 |
| TC-C-11 | Host kills hook mid-wait; agent cancels request; invalid hook output self-checks | F-07, F-09 |
| TC-C-12 | Disk full / DB error → defer all; key inconsistency → SAFE_MODE | F-17, F-24 |
| TC-C-13 | `hooks.json` removed/edited; IPC token wrong | F-23, F-25 |
| TC-C-14 | Flood of requests; caps and defer behave | F-28, F-30 |

**Safety assertion run across all TC-C:** the count of `auto_approve` outputs equals the count of verified phone Allow decisions. Any other value fails the build.

### 3.4 Security

| ID | Case | Controls |
|---|---|---|
| TC-S-01 | Active MITM on pairing is detected by SAS mismatch | SEC-02 |
| TC-S-02 | Reuse of a consumed ticket rejected | SEC-02 |
| TC-S-03 | Expired ticket rejected; redeem rate limit burns ticket | SEC-02 |
| TC-S-04 | Replay of captured decision rejected | SEC-03 |
| TC-S-05 | Digest tamper (phone or relay) rejected, security event | SEC-04 |
| TC-S-06 | Decision after expiry/cancel/decided rejected | SEC-06 |
| TC-S-07 | `allow` without valid per-use signature rejected | SEC-05 |
| TC-S-08 | Revoked device cannot connect/decide within 5 s | SEC-10 |
| TC-S-09 | Captured push payload contains no command text or tool name | SEC-13 |
| TC-S-10 | Unknown action refused and audited | SEC-08 |
| TC-S-11 | Relay flips bits in envelope/ct → AEAD fails; relay cannot read plaintext | SEC-01 |
| TC-S-12 | Edited audit entry detected by verifier | SEC-12 |
| TC-S-13 | Relay logs and metrics scanned for content/keys | SEC-13, NFR-08 |
| TC-S-14 | Key material at rest is wrapped; plaintext keys not found on disk | SEC-11 |

Manual pen pass (pre-MVP exit): relay auth bypass attempts, queue abuse, oversized/malformed frames, header injection, TLS configuration check.

### 3.5 Performance

| ID | Case | Target |
|---|---|---|
| TC-P-01 | Hook → phone display, phone connected; 200 samples on owner's networks | p95 ≤ 5 s (NFR-01) |
| TC-P-02 | Same via push with screen off | p95 ≤ 15 s (NFR-02) |
| TC-P-03 | Hook cold start + pass-through (paused / agent down) | ≤ 150 ms (NFR-06) |
| TC-P-04 | Agent idle for 1 h: RSS and CPU | ≤ 50 MB, < 1 % (NFR-05) |
| TC-P-05 | Relay with 100 queued messages and reconnect storms | No crash; caps hold |

### 3.6 Device

| ID | Case |
|---|---|
| TC-D-01 | Push delivery matrix: screen on/off, Doze, battery saver, swiped from recents; ≥ 99 % within TTL (excluding force-stop) |
| TC-D-02 | Android versions covering minSdk through current on available hardware/emulators |
| TC-D-03 | Vendor battery-manager behaviour on the owner's phone (Q-02) with documented exemption steps |
| TC-D-04 | 24 h idle battery attribution ≤ 2 % (NFR-07) |
| TC-D-05 | Biometric flows: success, failure, lockout, enrolment change invalidates key and recovery works |
| TC-D-06 | Lock-screen notification privacy; screenshot/overlay protections on approval screen |

### 3.7 Acceptance (real Antigravity)

| ID | Case |
|---|---|
| TC-A-01 | A real command is blocked, phone Allow lets it run |
| TC-A-02 | Same, phone Deny blocks it and the agent is told neutrally |
| TC-A-03 | Unattended two-hour session with phone in pocket: no unsafe approvals, no stuck requests |
| TC-A-04 | Lose-phone drill: revoke from laptop; old phone locked out; re-pair works |
| TC-A-05 | Pause/resume from tray; paused behaves as if Bridge were absent |

## 4. Traceability

| Requirement | Tests |
|---|---|
| FR-01 | TC-I-01, TC-S-01..03 |
| FR-02 | TC-A-01, TC-A-02 |
| FR-03 | TC-I-07 |
| FR-04 | TC-S-04..06 |
| FR-05 | TC-S-09, TC-D-01 |
| FR-06 | TC-C-02 |
| FR-07 | TC-I-12, TC-C-09 |
| FR-08 | TC-I-11 |
| FR-09 | TC-I-13, TC-S-12 |
| FR-10 | TC-S-10 |
| FR-11 | TC-S-08, TC-A-04 |
| FR-12 | TC-I-09, TC-U-08 |
| FR-13 | TC-S-07, TC-D-05 |
| FR-14 | TC-I-08 |
| FR-15 | TC-I-03, TC-I-11 |
| FR-16 | TC-P-03, TC-A-05 |
| FR-17 | TC-I-10 |
| NFR-01 | TC-P-01 |
| NFR-02 | TC-P-02, TC-D-01 |
| NFR-03 | TC-U-09, all TC-C |
| NFR-04 | TC-S-11 |
| NFR-05 | TC-P-04 |
| NFR-06 | TC-P-03 |
| NFR-07 | TC-D-04 |
| NFR-08 | TC-S-13 |
| NFR-09 | design review (adapter boundary) |
| NFR-10 | TC-I-14 |
| SEC-01..14 | see doc 04 §3 |

## 5. Entry and exit criteria

* **Entry for M2:** TC-U-01..05 pass; relay auth tests pass; S-01..S-04 passed or pivot decided.
* **Exit for MVP:** all Must-requirement tests pass; all TC-S pass; all TC-C pass with the safety assertion; TC-A-01..05 pass on the owner's surface; no open defect that violates NFR-03 or any SEC; two weeks of dogfood meeting PRD §10.
* **Regression gate:** TC-U, TC-I, TC-C, TC-S-* on every change; TC-I-15 on every Antigravity update.

## 6. Defect policy

Severity 1: anything that could cause auto-approval, leak content to the relay, or accept a forged/replayed decision. Sev 1 blocks release and requires a new regression test plus a threat-model review. Sev 2: incorrect UI state, missed notifications, broken recovery. Sev 3: cosmetic.