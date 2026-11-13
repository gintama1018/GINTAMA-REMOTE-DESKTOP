# 01 · Product Requirements Document (PRD)

| | |
|---|---|
| **Working title** | Bridge (placeholder, naming is open, see Q-12) |
| **Status** | Draft v0.1, pre-implementation, spike-gated |
| **Date** | 2026-11-13 |
| **Owner** | Sonu Jangir |
| **Reading order** | 00-README → **01-PRD** → 02-system-design → 03-protocol → 04-threat-model → 05-error-handling → 06-antigravity-integration → 07-adrs → 08-test-plan → 09-implementation-plan → 10-ux-flows → 11-risks-and-open-questions |

Evidence labels used across this doc set: **[V-DOC]** stated in vendor documentation fetched 2026-11-13, **[V-3P]** stated by a third party (not authoritative), **[ASSUME]** an assumption we have not verified (see A-xx in doc 11), **[SPIKE-n]** unknown until spike S-n is run (see doc 06).

---

## 1. Summary

An AI coding agent (Antigravity) stops and waits whenever it needs permission to run a command. If the owner steps away from the laptop, all progress stops until they return. Bridge lets the owner approve or deny those permission requests from an Android phone, from anywhere with internet, and perform a small set of safe remote actions on the laptop (lock the screen, check status).

Bridge consists of an Android app, a desktop agent on the laptop, a small cloud relay that both sides connect out to, and a thin hook client that Antigravity invokes before tool calls.

## 2. Problem statement

1. **Blocked unattended work.** Agent permission prompts appear on the laptop only. Away from the laptop, the agent idles at the prompt.
2. **No safe remote path.** The owner's alternatives today are broadening permissions (weaker safety) or staying at the desk.
3. **No reachability.** The laptop sits behind NAT on changing networks; nothing outside can connect to it, and the phone cannot signal a laptop that has no always-on component listening for it.

## 3. Goals

| ID | Goal |
|---|---|
| G-1 | Approve or deny an Antigravity permission request from the phone within seconds of it appearing, from any network. |
| G-2 | Never be less safe than the owner's existing local policy: any failure falls back to local behaviour, never to auto-approval. |
| G-3 | Keep command content confidential from the relay and from push infrastructure (end-to-end encryption). |
| G-4 | Provide a tamper-evident audit trail of every remote decision. |
| G-5 | Allow remote screen lock of the laptop. |
| G-6 | Be designed so other agent tools can be added later via an adapter, without changing the relay or phone app. |

## 4. Non-goals (v1)

| ID | Non-goal | Reason |
|---|---|---|
| NG-1 | Arbitrary remote shell or command execution from the phone | Turns a convenience into a remote-access backdoor; see ADR-008 |
| NG-2 | Remote unlock of the laptop | Unacceptable credential-handling risk; see ADR-008 |
| NG-3 | Screen streaming, remote mouse/keyboard, file transfer | Different product, different threat surface |
| NG-4 | Starting or steering agent conversations from the phone | Requires Antigravity-side surface we have not verified |
| NG-5 | "Always allow" rules created from the phone | Creates persistent privilege from a low-friction device; see ADR-009 |
| NG-6 | Multi-tenant SaaS, accounts, billing | Relay is personal infrastructure; see ADR-006 |
| NG-7 | iOS client | Owner asked for an APK |
| NG-8 | Wake-on-LAN / powering on a sleeping laptop | Needs LAN presence or vendor firmware support |
| NG-9 | Controlling IDEs other than Antigravity | Deferred; adapter boundary only (G-6) |

## 5. Users and scenarios

Single user: the owner-operator, who is also the sole developer. One laptop, one phone in v1 (A-02).

| ID | Scenario |
|---|---|
| SC-1 | Owner leaves the desk with an agent mid-task. A command needs permission. Phone notifies; owner reviews the exact command and taps Allow (after biometric). Agent continues. |
| SC-2 | Owner realises they left the laptop unlocked at a shared place. Opens the app, taps Lock. |
| SC-3 | Owner wants to know if the laptop is online and whether the agent is waiting on them. |
| SC-4 | Owner loses the phone. From the laptop (or a recovery path) they revoke the pairing. |
| SC-5 | Owner is back at the laptop while a phone request is pending; the request should become a normal local prompt without waiting out a timer. |

## 6. Functional requirements

Priority uses MoSCoW. Phase maps to milestones in doc 09.

| ID | Requirement | Pri | Phase | Acceptance criteria (summary) |
|---|---|---|---|---|
| FR-01 | **Pairing.** Pair one phone with one desktop via QR shown on the desktop and scanned by the phone, with a short authentication string (SAS) confirmed on both screens. | Must | M1 | Pairing succeeds only if SAS matches; expired/reused QR is rejected; MITM test fails (TC-S-01..03). |
| FR-02 | **Approval relay.** For configured Antigravity tools, intercept the pre-execution hook, send the request to the phone, and return the owner's decision to Antigravity. | Must | M2 | End-to-end Allow and Deny change the outcome of a real command (TC-A-01, TC-A-02). |
| FR-03 | **Approval content.** Phone shows tool name, full untruncated command/arguments, working directory, workspace, short conversation id, timestamp, risk tier, remaining time. | Must | M2 | Command of 8 KiB renders completely and scrollably; no silent truncation (TC-I-07). |
| FR-04 | **Approval binding.** A decision is bound to the exact tool call by digest, is single-use, and expires. | Must | M2 | Tampered digest, replayed decision, late decision all rejected (TC-S-04..06). |
| FR-05 | **Wake push.** When the phone is not connected, send a content-free push to wake the app. | Must | M3 | Push contains no command text; app fetches request on wake (TC-S-09, TC-D-01). |
| FR-06 | **TTL and fallback.** Each request has a TTL. On expiry the configured fallback applies; default is defer to the local prompt. | Must | M2 | Expiry returns defer; local prompt appears; phone shows Expired (TC-C-02). |
| FR-07 | **Remote lock.** Phone can lock the laptop screen. | Should | M5 | Lock executes ≤ 5 s when both online; stale lock (> TTL) is discarded (TC-I-12, TC-C-09). |
| FR-08 | **Status.** Phone shows laptop online state, last seen, pending approvals, bridge state (active/paused). | Should | M5 | Offline laptop shows last-seen within 90 s of loss (TC-I-11). |
| FR-09 | **Audit log.** Append-only, hash-chained, local-authoritative log of every request and decision; viewable on phone. | Must | M4 | Tampering with an entry is detected by verification (TC-S-12). |
| FR-10 | **Action registry.** Remote actions limited to an enumerated, typed registry; anything else is rejected. | Must | M5 | Unknown action returns BR-4003 and is audited (TC-S-10). |
| FR-11 | **Revocation.** Either side can unpair; desktop has a panic "revoke all"; relay stops routing for revoked devices. | Must | M4 | Revoked phone cannot fetch or decide within 5 s of revocation (TC-S-08). |
| FR-12 | **Local policy.** User-defined deny patterns (auto-deny, never sent to phone) and risk tiering rules. | Should | M4 | Matching command denied without notification; tier shown on phone (TC-I-09). |
| FR-13 | **Biometric-gated Allow.** Allow requires per-use user authentication, cryptographically enforced (ADR-009). Deny needs none. | Must | M3 | Allow without a valid per-use signature is rejected by desktop (TC-S-07). |
| FR-14 | **Concurrent requests.** Multiple pending requests are independent and queued on phone. | Must | M2 | 5 parallel requests resolve independently (TC-I-08). |
| FR-15 | **Heartbeat and presence.** Both ends report liveness; offline state is shown. | Must | M2 | See FR-08 and NFR-01. |
| FR-16 | **Pause/resume.** Owner can pause the bridge from the desktop tray; paused means pass-through to local policy. | Must | M2 | Paused hook returns in ≤ NFR-06 (TC-P-03). |
| FR-17 | **Presence-aware routing.** If the owner is active at the laptop, do not route to phone; if activity starts while a request is pending, cancel the remote wait and defer to local. | Should | M4 | Input at laptop within threshold causes defer ≤ 2 s (TC-I-10). |

## 7. Non-functional requirements

Targets are **unvalidated** until the named spike or test confirms them.

| ID | Requirement | Target | Validated by |
|---|---|---|---|
| NFR-01 | Hook → phone display latency, phone connected | p95 ≤ 5 s | TC-P-01 |
| NFR-02 | Hook → phone display latency via push | p95 ≤ 15 s, ≥ 99 % delivered within TTL (app not force-stopped) | S-05, TC-D-01 |
| NFR-03 | **Fail-safe**: no failure mode produces an auto-approval | 0 occurrences | FMEA (doc 05), TC-C-* |
| NFR-04 | Relay never holds plaintext of requests, decisions or actions | by construction | TC-S-11 |
| NFR-05 | Desktop agent idle footprint | ≤ 50 MB RSS, < 1 % CPU | TC-P-04 |
| NFR-06 | Hook cold start + pass-through when paused or agent down | ≤ 150 ms | S-10, TC-P-03 |
| NFR-07 | Phone battery impact over 24 h idle | ≤ 2 % attributable | TC-D-04 |
| NFR-08 | Relay logs contain no payload content, keys or command text | 0 occurrences | TC-S-13 |
| NFR-09 | Platform-specific code isolated behind an adapter | Windows adapter first (A-01) | design review |
| NFR-10 | Protocol versioned; N-1 compatibility | enforced | TC-I-14 |

## 8. Constraints

* Antigravity is a fast-moving product; hook semantics may change between versions (R-03). We target the documented contract and test against pinned versions.
* The laptop is behind NAT and on varied networks; both endpoints must dial out (ADR-002).
* Android push is best-effort (R-04, R-14).
* Solo developer; scope must be cut by phase, not by quality (R-12).

## 9. Dependencies

| Dependency | Risk | Doc |
|---|---|---|
| Antigravity PreToolUse hook contract | High: feasibility hinges on whether `auto_approve` suppresses the local prompt in usable modes | 06 (S-01..S-04) |
| Firebase Cloud Messaging | Medium | ADR-005, S-05 |
| Relay hosting (VM + domain + TLS cert) | Low | ADR-006, Q-06 |
| Android Keystore / BiometricPrompt | Low | ADR-009 |

## 10. Success metrics

MVP exit (end of M4, after two weeks of dogfooding):

1. ≥ 98 % of requests made while the phone was online resulted in a delivered, decidable prompt.
2. 0 unauthorised or mismatched approvals in the audit log.
3. 0 occurrences of a failure causing auto-approval (NFR-03).
4. p95 latency meets NFR-01 on the owner's real networks.
5. Owner reports the bridge is usable unattended for a full working session without babysitting.

Counter-metric (watch for approval fatigue, R-05): approvals per hour and median time-to-approve; a very low median combined with high volume signals rubber-stamping.

## 11. Release phases

| Phase | Contents | Gate |
|---|---|---|
| P0 Feasibility | Spikes S-01..S-10 | G0: go / pivot / stop (doc 09 §4) |
| P1 MVP | FR-01..06, 09, 13..16 | MVP exit above |
| P2 Hardening | FR-11, 12, 17; chaos and security test pass | Test plan exit criteria |
| P3 Actions | FR-07, 08, 10 | |
| P4 Extensions | Key rotation, other agent adapters, long-poll fallback | Out of scope here |

## 12. Open items

Product decisions that need the owner's input are in doc 11 §2 (Q-01..Q-13). Until answered, defaults in doc 11 §3 (A-01..A-09) apply and are marked wherever they shape a design.