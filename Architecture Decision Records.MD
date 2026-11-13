# 07 · Architecture Decision Records

| | |
|---|---|
| **Status** | Draft v0.1 |
| **Date** | 2026-11-13 |
| **Statuses used** | *Proposed* (reasoned, not yet validated), *Gated* (depends on a spike), *Accepted*, *Superseded* |

Each record lists real alternatives, the trade-off, and what would make us revisit. Where the owner's input is still needed, that is stated rather than guessed.

---

## ADR-001 · Integration mechanism with Antigravity

**Status:** Gated on S-01, S-02, S-03, S-04.

**Context.** The agent's permission prompt is owned by Antigravity. We need to learn about each prompt and influence its outcome.

| Option | Pros | Cons |
|---|---|---|
| **A. `PreToolUse` hook** (documented API) | Official, works in App/CLI/IDE, no UI hacking, structured data | Decision semantics under presets unproven (S-01); timeout cap unknown (S-02); coverage limited (S-03); vendor may change |
| **B. ACP client** (desktop agent hosts `agy acp`, answers permission requests) | Documented permission request/response with Allow/Deny; no hook semantics dependency | Sessions run through our client, not the IDE UI; hooks/presets in ACP not documented; more build effort |
| **C. UI automation / DevTools-protocol clicking** | Works with any prompt | Fragile across updates; needs a debug port open on the editor; large attack surface; unsupported |
| **D. Antigravity SDK custom agent** | Full control | Not the owner's IDE sessions |
| **E. Transcript/file tailing** | Passive visibility | Cannot influence decisions |

**Decision.** Primary **A**; **B** is the pre-designed pivot (doc 09 §4). **C** is rejected on security and fragility. D and E do not meet the goal.

**Consequences.** Everything about A's reliability is isolated in doc 06 and a hook-adapter boundary in the desktop agent so B can replace it without touching relay, phone or protocol.

**Revisit when:** S-01 fails on the owner's surface; Antigravity changes hook semantics.

---

## ADR-002 · Network topology

**Status:** Proposed.

| Option | Pros | Cons |
|---|---|---|
| **A. Cloud relay, both ends dial out** | Works behind NAT/CGNAT and on any network; no inbound ports; simple mental model | Needs a hosted component; metadata visible to relay |
| B. Direct peer-to-peer (hole punching) | No server for data | Needs signalling and TURN fallback anyway; NAT variability |
| C. Private overlay network (generic WireGuard-style) | Strong transport security | Another system to operate; phone VPN always-on battery/UX; doesn't solve push |
| D. Port-forward + dynamic DNS | No third party | Breaks on CGNAT, campus networks; exposes laptop to the internet |

**Decision.** A. A relay is needed for signalling in B anyway, and C/D fail on the owner's variable networks (S-08 will confirm).

**Consequences.** We own an internet-facing service (hardening burden, doc 04), mitigated by E2E encryption so the relay is untrusted for content.

---

## ADR-003 · Transport

**Status:** Proposed.

| Option | Verdict |
|---|---|
| **WebSocket over TLS + small REST surface** | Chosen: bidirectional, first-class on Android and Go, passes through most proxies on 443, simple framing |
| gRPC streaming | Heavier toolchain, proxy/HTTP2 friction, little benefit |
| MQTT | Good fit for mobile presence, but requires a broker and a second auth model |
| SSE + POST | Workable but two channels and awkward ordering |
| HTTP long-poll | Kept as Phase 4 fallback (OD-5) |

**Revisit when:** S-08 shows WSS blocked on networks the owner uses.

---

## ADR-004 · End-to-end cryptography and pairing

**Status:** Proposed. **Requires crypto review (R-10) before M1 exit.**

**Context.** Relay is untrusted. Requests and decisions can be sent while the other peer is offline, so interactive per-message handshakes are not possible.

| Option | Pros | Cons |
|---|---|---|
| **A. Pair once with Noise XXpsk3 + SAS; derive directional symmetric AEAD keys; per-message AEAD with sequence numbers** | Async-friendly, small, well-understood primitives, MITM resistance via PSK+SAS | No forward secrecy against later key theft in v1 |
| B. Per-message public-key sealing (HPKE-style) | Sender ephemeral keys | Receiver long-term key still the single point; heavier; Keystore X25519 support varies |
| C. Interactive session protocol (Noise IK per connection) | Forward secrecy | Needs both peers online at handshake; complicates queued requests |
| D. TLS only | Trivial | Relay reads everything |

**Decision.** A, with an upgrade path to epoch rekey (Phase 4) which restores forward secrecy when both ends are online. Primitives and encodings in doc 03 §4. **Do not implement primitives; use vetted libraries** (S-07).

**Consequences.** Compromise response is revoke + re-pair (T-17). Shared test vectors are mandatory (doc 03 §13).

---

## ADR-005 · Push strategy

**Status:** Proposed, validated by S-05.

| Option | Pros | Cons |
|---|---|---|
| **A. FCM high-priority data message, content-free, app posts a visible notification then fetches** | Standard, works in Doze, no content at Google | Google dependency; vendor battery managers can still interfere |
| B. FCM notification message with generic text | OS shows it without app code | Less control of actions/privacy; still needs fetch |
| C. Persistent socket via foreground service | No Google dependency | Permanent notification, battery cost, OS limits |
| D. UnifiedPush / self-hosted push | No Google | Extra infrastructure and app dependency |

**Decision.** A. Fall back to C or D only if S-05 fails.

**Consequences.** Push is best-effort; the UI explains that force-stopped apps get nothing; TTL expiry covers missed pushes safely.

---

## ADR-006 · Relay shape and hosting

**Status:** Proposed; hosting provider pending **Q-06**.

| Dimension | Decision | Why |
|---|---|---|
| Tenancy | Single-tenant personal infrastructure | Avoids accounts, billing, abuse handling (NG-6) |
| Instances | One instance, no HA | Failure is safe by design (defer); simplicity |
| Storage | SQLite (WAL) on a persistent volume, nightly snapshot | Tiny data; no operational database |
| Runtime | Containerised long-lived process | WebSockets need persistent connections; serverless request/response platforms are a poor fit |
| TLS | Managed certificate with auto-renew | |

**Consequences.** Relay loss = re-pair (F-27). Acceptable for one user; revisit if the product is ever offered to others (would need tenancy, HA, abuse controls).

---

## ADR-007 · Failure semantics: defer to local

**Status:** Proposed (strongly; safety-critical).

**Context.** When the bridge cannot get a human decision, something must happen.

| Option | Outcome | Verdict |
|---|---|---|
| **Defer (pass-through via `allow`) so Antigravity's own policy applies** | Slower, never less safe | **Chosen default** |
| Deny on failure | Safe but the agent may probe alternatives, creating more prompts and noise | Optional per owner (`on_timeout=deny`), not default |
| Auto-approve on failure | Unsafe | **Prohibited** |
| `force_ask` on failure | Forces local prompt even where the owner's policy would allow silently | Rejected as default: it would make the bridge stricter than the owner's own configuration |

**Decision.** Default `defer`. The invariant "no failure auto-approves" (NFR-03, I-4) is enforced by structure: the only path to `auto_approve` is `DECIDED` with all checks passed.

**Consequences.** While the owner is away and the hook has returned defer, the local prompt waits at the laptop. The request is "stranded" until they return; the phone shows Expired. Re-requesting remotely is not possible in v1 (NG-4).

---

## ADR-008 · Remote action surface

**Status:** Proposed.

| Option | Verdict |
|---|---|
| **Enumerated registry; v1 = `lock`, `status`** | Chosen |
| Arbitrary shell command from phone | Rejected (NG-1): remote-code-execution channel; one phone compromise equals laptop compromise |
| Remote unlock | Rejected (NG-2): needs credential handling and weakens the lock |
| Plugin system for custom actions | Deferred: needs a signing/trust model |

**Consequences.** New actions require a code change, tests and a threat-model update (SEC-08). Unknown action → BR-4003 and audit.

---

## ADR-009 · Approval gesture and decision authenticator

**Status:** Proposed. **Requires design review at M3.**

**Context.** A UI-only biometric check can be bypassed by anything that can send the decision message. We want the desktop to be able to verify that a user-authentication event occurred on the phone.

| Option | Pros | Cons |
|---|---|---|
| **A. Per-use-authentication Keystore signing key (ECDSA P-256); `allow` carries a signature over `rid | digest | decision | device_id`; desktop verifies** | Cryptographically enforces the gesture; hardware-backed where available; invalidated on biometric enrolment change | More complexity; key invalidation recovery flow |
| B. UI-gated biometric then AEAD only | Simple | Gate is advisory |
| C. PIN/hold-to-confirm only | Works without biometrics | Weakest |

**Decision.** A for `allow`; `deny` needs no authentication. Additional friction by tier: tier 3 requires press-and-hold plus a 3-second review delay (anti-fat-finger, anti-fatigue). **No "always allow"** from the phone (NG-5), every approval is one call.

**Consequences.** If biometrics change on the phone and the key is invalidated, the owner must re-pair the decision key (planned UF-05 variant). MVP prototype in M2 MAY use B temporarily, marked unsafe for unattended use; M3 replaces it.

---

## ADR-010 · Implementation stack

**Status:** Proposed. **Owner input required (Q-05); not blocking until M1 starts.**

| Component | Proposal | Reasoning | Alternative |
|---|---|---|---|
| Phone | Kotlin + Jetpack Compose, native | FCM, Keystore, BiometricPrompt and background behaviour are first-class and least surprising on Android; APK-only requirement | Flutter/React Native add a bridge layer for exactly the features we depend on |
| Desktop agent + hook client | One language producing a single static binary with a "hook" subcommand; **Go** proposed | Fast cold start (NFR-06), easy cross-compile, solid crypto/WebSocket libraries, simple distribution | Rust (more control, higher effort); Python (fast to write, but cold start and runtime packaging risk for the hook, S-10) |
| Relay | Same language as the agent | Shared protocol and crypto code, one toolchain | Node |
| Storage | SQLite everywhere | One technology | |

**Decision.** Proposed as above; confirm against the owner's comfort with the languages (Q-05). If the owner prefers Python or TypeScript for the agent, run S-10 first; the hook must still meet NFR-06.

---

## ADR-011 · Device authentication to relay

**Status:** Proposed.

| Option | Verdict |
|---|---|
| **Per-device Ed25519 key, challenge-response on each connection; desktop enrolled with an operator enrollment token; phones enrolled only via single-use pairing tickets** | Chosen: no long-lived bearer secrets on the wire; revocation by deleting a public key |
| Static API tokens | Rejected: theft is replayable |
| OAuth / user accounts | Unneeded for a single-owner system |
| mTLS with client certificates | Valid, but certificate lifecycle on Android is heavier than keypair challenge-response |

---

## ADR-012 · Time and expiry authority

**Status:** Proposed.

**Decision.** The desktop agent owns each request's deadline using its **monotonic clock**. Messages carry `remaining_ms`; the phone counts down locally from receipt. Wall-clock timestamps are informational only. Rationale: phones, laptops and relays have unsynchronised clocks, NTP steps and timezone changes (F-20); relying on shared wall-clock time would cause either spurious expiries or accepting stale approvals. Cost: displayed countdown can be off by network latency (a few seconds); the desktop's verdict is final.

---

## ADR-013 · Delivery semantics

**Status:** Proposed.

**Decision.** At-least-once delivery between peers via the relay; exactly-once *effect* through `rid` single-use and `seq` monotonicity; FIFO queue per recipient; **one active connection per device** (a newer connection displaces the older) so ordering is unambiguous; messages have TTL and are never delivered after expiry; the phone keeps a persistent outbox for decisions. Alternatives (exactly-once transport, unordered with windows) add complexity without benefit at this scale.

---

## ADR-014 · Presence-aware routing

**Status:** Proposed.

**Context.** While a hook is blocking for the phone, the owner at the laptop would see the agent frozen with no prompt (the local prompt appears only after the hook returns).

**Decision.** The desktop agent checks activity: if the owner has been active within P seconds (default 60) and the session is unlocked, **defer immediately** (the local prompt shows at once). If activity begins during a remote wait, cancel the wait and defer within 2 s. Also offer a tray toggle to disable (S-09 may force this).

**Alternatives.** Always route to phone (annoying at the desk), duplicate the prompt on desktop (a second approval UI to secure and maintain).

---

## ADR-015 · Audit log

**Status:** Proposed.

**Decision.** Local, append-only, hash-chained (each entry includes the hash of the previous) in the desktop database; phone keeps a cached history; a verification command recomputes the chain. Chosen over remote logging because the relay is untrusted and must not hold content, and over plain text logs because tamper evidence is the point. Limitation: an attacker with full local control can truncate; phone history gives a cross-check but is not authoritative.