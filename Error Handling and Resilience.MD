# 05 · Error Handling and Resilience

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-11-13 |
| **Governs** | NFR-03 (fail-safe), SEC-07, ADR-007, ADR-013 |

---

## 1. Principles

1. **Fail to local policy, never to approval.** Any uncertainty resolves to `defer`: the hook passes through and Antigravity applies whatever the owner's own settings say (ADR-007). The bridge may make the owner's life slower; it must never make it less safe.
2. **The hook always answers, exactly once, and quickly.** A hook that hangs or emits garbage is itself a failure mode (S-04). The hook has a hard internal deadline shorter than Antigravity's hook timeout.
3. **Desktop is the authority.** Request state, deadlines, and the final verdict live on the desktop (ADR-012). Phone and relay are advisory transport.
4. **Audit before answer.** The state transition is written to the audit log before the hook is answered (I-3). If the audit write fails, answer `defer`.
5. **Idempotent everywhere.** Duplicates are normal at the relay (at-least-once); the receiver makes effects exactly-once (ADR-013).
6. **Detect, classify, act.** Every error has a code (§6), a class (§2), a retry rule (§4), and a user-visible message (§8).
7. **No silent degradation.** If the bridge is not protecting/serving, the tray and phone say so.

## 2. Error classes

| Class | Examples | Retry | Safe-state action | Alerting |
|---|---|---|---|---|
| **Transient** | Network drop, relay restart, FCM delay | Yes, backoff (§4) | Defer new requests if relay unreachable | After 10 min |
| **Auth** | Bad signature, revoked device, expired ticket | No, needs user action | Disconnect; defer | Immediately for revoked/rogue |
| **Protocol** | Unsupported version, unknown message type, schema violation | No | Drop message, audit | Rate-based |
| **Integrity** | AEAD failure, digest mismatch, replay, bad signature | No | Reject, audit as security event, defer pending request | Immediately; poison threshold (§5) |
| **Resource** | Queue full, rate limited, payload too large | After `retry_after` | Defer locally | On sustained |
| **Local** | IPC failure, disk full, config invalid, hook config changed | Limited | Defer; enter SAFE_MODE if identity/key related | Immediately |
| **Compatibility** | Antigravity contract changed | No | Defer all (pass-through) | Immediately |

## 3. Failure Modes and Effects Analysis

Detection → effect → safe state → recovery, per failure. "Defer" means the hook returns pass-through and Antigravity's local policy applies.

| ID | Failure | Detection | Immediate effect | Safe state / automatic response | User sees | Recovery | Tests |
|---|---|---|---|---|---|---|---|
| F-01 | Relay unreachable (desktop) | Connect error or missed pings | No remote path | New requests: defer (`relay_down`); reconnect with backoff | Tray: "Offline – local prompts only" | Auto-reconnect | TC-C-03 |
| F-02 | Relay unreachable (phone) | Connect error | Phone cannot fetch | Outbox retains decisions until expiry | Banner "No connection" | Auto-reconnect | TC-C-04 |
| F-03 | Phone offline, push not delivered | No receipt within grace (10 s) | Request sits at relay | Waits until TTL then defer | Tray: "Waiting for phone" | Phone returns or TTL | TC-D-01 |
| F-04 | FCM delay/failure | Push API error or no receipt | Wake late/missing | Continue waiting until TTL; log BR-6002 | Phone shows late | Open app manually | TC-D-01..03 |
| F-05 | Agent not running when hook fires | IPC connect fails | None | Hook answers defer immediately (BR-4001) | Local prompt; agent restart note | Autostart / start agent | TC-C-01 |
| F-06 | Agent crashes mid-request | Hook IPC EOF; phone sees stale | Pending requests orphaned | Hook answers defer on EOF; on restart, all non-terminal requests marked `CANCELLED` | Local prompt appears | Restart | TC-C-01 |
| F-07 | Hook process killed or timed out by Antigravity | Agent sees IPC close before answer | Antigravity applies its own timeout behaviour (S-04) | Agent marks `CANCELLED`, sends `approval.cancel` | Phone: "Cancelled" | None | TC-C-11 |
| F-08 | Malformed/unknown hook input | Parse error or schema mismatch | None | Hook answers defer; logs BR-4002 | Tray warning if repeated | Update bridge | TC-I-15 |
| F-09 | Hook emits invalid output | Self-check before print | Possible host fail-closed (V-3P) | Hook validates its own JSON against the contract; falls back to a minimal known-good defer document | Local prompt | None | TC-C-11 |
| F-10 | TTL reached | Desktop monotonic deadline | Request expires | `approval.expired` to phone; hook answers defer | Phone: Expired; local prompt | Re-run action | TC-C-02 |
| F-11 | Duplicate delivery | Same `msg_id`/`seq` | None | Drop duplicate silently, count | Nothing | None | TC-C-05 |
| F-12 | Out-of-order or replayed message | `seq` ≤ highest | Possible attack | Drop, audit BR-2004, security event | Notification if repeated | Investigate | TC-C-06, TC-S-04 |
| F-13 | Single decrypt/AEAD failure | AEAD tag fails | Message unusable | Drop, audit BR-3001 | Nothing (counter) | None | TC-S-11 |
| F-14 | Decrypt failures repeat | > 5 in 10 min | Possible attack or key mismatch | Quarantine peer: pause remote routing, SAFE_MODE candidate | Alert + tray "Security" | Re-pair | TC-S-11 |
| F-15 | Digest mismatch | §7 step 6 of doc 03 | Possible tamper or phone bug | Reject, defer request, audit as security event | Alert | Investigate | TC-S-05 |
| F-16 | Decision after expiry/cancel | State check | None | Drop, audit BR-2002 | Phone: "Too late" | None | TC-S-06 |
| F-17 | Key or identity inconsistency (restored backup, `seq` regression, unknown peer key) | Startup consistency check | Cannot trust state | Enter SAFE_MODE: all requests defer; remote actions disabled | Tray: "Safe mode – re-pair" | Re-pair | TC-C-12 |
| F-18 | Laptop sleeps/hibernates | Heartbeat stops | Agent offline | Relay marks offline; phone shows last seen; queued interactive messages expire | Phone: "Laptop offline" | Wake | TC-C-10 |
| F-19 | Laptop network change mid-request | Socket error | Connection drop | Reconnect; request state intact; if not back by TTL, defer | Tray reconnecting | Auto | TC-C-04 |
| F-20 | Clock jump / NTP step | Wall vs monotonic divergence | Wrong countdowns if wall-clock used | Deadlines use monotonic clock; wall time informational (ADR-012) | None | None | TC-C-07 |
| F-21 | Phone app killed mid-decision | Outbox row present at restart | Decision not sent | Outbox retry until acked or request expired | Pending shown on reopen | Auto | TC-C-08 |
| F-22 | Biometric failure/lockout | Keystore error | Cannot sign Allow | Allow unavailable; Deny still possible; request will expire | "Authenticate to allow" | Unlock phone | TC-S-07 |
| F-23 | IPC token mismatch or ACL violation | Auth failure | Untrusted local caller | Reject, defer, audit | Tray warning | Reinstall | TC-C-13 |
| F-24 | Disk full or DB error on desktop | Write error | Cannot audit or persist `seq` | Defer all; remote disabled; alert | Tray error | Free space | TC-C-12 |
| F-25 | `hooks.json` edited/removed externally | File watch / startup hash check | Hook may not fire | Alert; **no** auto-rewrite without user confirm | Tray: "Hook missing" | Re-install hook | TC-C-13 |
| F-26 | Antigravity contract change | Contract test, input schema drift | Unknown semantics | Defer all; show compatibility warning | Tray warning | Update bridge or pin | TC-I-15 |
| F-27 | Relay DB lost/restored | Auth fails for known devices | Cannot route | Devices see BR-1002; user re-pairs | "Re-pair required" | Re-pair | TC-I-02 |
| F-28 | Queue full / rate limited | Relay returns BR-5002/BR-5001 | Requests rejected | Defer locally, back off | Tray notice | Wait | TC-C-14 |
| F-29 | Presence flapping | > 3 transitions/min | Noisy UI | Debounce 10 s | Stable state | None | TC-I-11 |
| F-30 | Flood of concurrent approvals | Per-conversation cap | Phone overload | Excess defers locally | "Too many pending" | Reduce agent parallelism | TC-C-14 |

## 4. Retry, timeouts and budgets

### 4.1 Reconnect backoff (relay connection)

Full-jitter exponential backoff: delay = random(0, min(cap, base × 2^attempt)), base 1 s, cap 60 s, reset after 60 s of stable connection. Immediately retry once on a clean close. These are **initial values**; tune from S-08.

### 4.2 Outbox retry (phone decisions)

Retry at 1, 2, 4, 8 s then every 15 s until acked or request expiry. Persistent across process death.

### 4.3 Heartbeats

WebSocket ping every 25 s (below typical NAT/proxy idle timeouts, to be confirmed in S-08). Application presence every 30 s ± 5 s. Peer considered offline after 70 s without traffic.

### 4.4 Timeout budget (initial values, parameterised)

| Parameter | Symbol | Initial | Rationale / validation |
|---|---|---|---|
| Approval TTL | T | 300 s | Enough for a person to react from a pocket; bounded by H below |
| Hook timeout configured in `hooks.json` | H | T + 20 s | Must exceed T or the host may cut the hook mid-wait; **Antigravity default is 30 s** [V-DOC] so H MUST be set explicitly |
| Maximum allowed H | H_max | unknown | **S-02 determines**; if H_max < T + 20 then T = H_max − 20 |
| Hook internal hard deadline | D | H − 5 s | Hook always answers before the host's timeout |
| IPC response margin | | 2 s | Agent answers hook at most T + 2 s |
| Presence activity threshold | P | 60 s | User input within P seconds means defer immediately (FR-17) |
| Action validity | | 120 s | Stale lock discarded |
| Queue TTL (interactive) | | ≤ T | Relay never delivers after expiry |
| Pairing ticket | | 300 s | |

If the owner raises T, H and queue TTL must be raised together; the agent validates this invariant at startup and refuses inconsistent configs (BR-4002).

## 5. Poison messages and security events

* Counters per peer in a rolling 10-minute window: AEAD failures, digest mismatches, replay rejections, signature failures.
* Thresholds: 5 AEAD failures **or** 3 digest mismatches **or** 3 signature failures → quarantine peer (remote routing paused, SAFE_MODE candidate), raise alert on laptop tray and (if channel still trusted) phone.
* A single digest mismatch is always audited as a security event.
* Poison messages are never retried and are not forwarded to logs with content; log only ids, sizes and codes.

## 6. Error code catalogue

Format `BR-<class><nnn>`. Classes: 1 connectivity/auth, 2 request/decision, 3 crypto/pairing, 4 local/config, 5 resource, 6 push, 7 protocol/identity.

| Code | Name | Class | Raised by | Meaning | Handling |
|---|---|---|---|---|---|
| BR-1001 | RELAY_UNREACHABLE | Transient | C1, C2 | Cannot connect to relay | Backoff; defer new requests |
| BR-1002 | AUTH_FAILED | Auth | C3 | Challenge-response failed or unknown device | Disconnect; do not retry blindly; surface |
| BR-2001 | PEER_OFFLINE | Transient | C3, C2 | Recipient not connected | Push if allowed; wait to TTL |
| BR-2002 | DECISION_EXPIRED_OR_UNKNOWN | Protocol | C2 | Decision for expired, cancelled, decided or unknown `rid` | Drop, audit |
| BR-2003 | DIGEST_MISMATCH | Integrity | C2 | Phone digest ≠ desktop digest | Security event; defer |
| BR-2004 | REPLAY_REJECTED | Integrity | C2, C1 | `seq` not greater than stored | Drop, audit, count |
| BR-2005 | DECISION_SIGNATURE_INVALID | Integrity | C2 | Allow without valid per-use signature | Reject, security event |
| BR-3001 | DECRYPT_FAILED | Integrity | C1, C2 | AEAD verification failed or handshake mismatch | Drop, count toward poison threshold |
| BR-3002 | PAIRING_TICKET_INVALID | Auth | C3 | Expired, reused or unknown ticket | Restart pairing |
| BR-3003 | SAS_MISMATCH | Integrity | C1, C2 | User reported different SAS | Abort, burn ticket, warn about MITM |
| BR-4001 | IPC_UNAVAILABLE | Local | C4 | Hook cannot reach agent | Hook answers defer |
| BR-4002 | CONFIG_INVALID | Local | C2, C4 | Invalid config, inconsistent timeouts, hook entry malformed | Refuse to activate; defer |
| BR-4003 | ACTION_NOT_ALLOWED | Policy | C2 | Action outside registry | Reject, audit |
| BR-5001 | RATE_LIMITED | Resource | C3 | Per-device rate limit | Honour `retry_after_s` |
| BR-5002 | QUEUE_FULL | Resource | C3 | Per-device queue cap hit | Defer; backoff |
| BR-5003 | PAYLOAD_TOO_LARGE | Resource | C3, C2 | Envelope over 64 KiB | Defer with explicit reason |
| BR-6001 | PUSH_TOKEN_INVALID | Transient | C3 | FCM reports unregistered token | Phone re-registers token on next open |
| BR-6002 | PUSH_FAILED | Transient | C3 | FCM error | Retry once; continue waiting |
| BR-7001 | PROTOCOL_VERSION_UNSUPPORTED | Protocol | any | Version outside N..N-1 | Prompt upgrade; do not process |
| BR-7002 | DEVICE_REVOKED | Auth | C3 | Device has been revoked | Wipe local pairing material on that device |

## 7. Degradation modes

| Mode | Trigger | Behaviour | Indicator |
|---|---|---|---|
| **Normal** | All healthy | Full function | Green |
| **Phone unreachable** | Phone offline/ push failing | Requests wait to TTL then defer | Amber "Waiting for phone" |
| **Local-only** | Relay unreachable | Immediate defer for all | Amber "Offline – local prompts only" |
| **Paused** | Owner action (FR-16) | Immediate defer | Grey |
| **Safe mode** | Key/identity inconsistency, quarantine | Immediate defer; remote actions disabled | Red |
| **Incompatible** | Contract drift (F-26) | Immediate defer | Red "Update bridge" |

## 8. Messaging rules

* Messages state **what happened, what the system did, and what the user can do**, without internal jargon. Always include the BR code in a small secondary line for support.
* Security events use distinct, non-dismissable-for-5-s styling and never include command text on lock screens.
* Never write "approved" language for deferrals. Defer text: "Not approved. Sent back to the laptop prompt."

Examples (copy lives in doc 10):

| Code | Phone message |
|---|---|
| BR-2002 | "This request already ended. Nothing was approved." |
| BR-2003 | "This request didn't match what the laptop sent. Nothing was approved. Check the laptop." |
| BR-7002 | "This phone was removed from the laptop. Pair again to use it." |

## 9. Recovery runbooks (owner-facing)

| Situation | Steps |
|---|---|
| Lost phone | On the laptop tray: Revoke all → confirm → re-pair new phone. Rotate relay enrollment token if the phone also held it. |
| Relay host replaced | Update relay URL in agent config; re-enrol desktop with new operator token; re-pair phone. |
| Safe mode | Check audit log for the triggering event; if benign (restored backup), re-pair; if not, treat as incident (rotate tokens, inspect `hooks.json`). |
| Antigravity update broke hook | Tray shows Incompatible; check doc 06 compatibility table; pin Antigravity or update bridge adapter. |
| Hook missing | Re-run hook installer; it backs up and merges (doc 06 §6). |