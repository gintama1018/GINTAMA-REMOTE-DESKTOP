# 03 · Protocol Specification

| | |
|---|---|
| **Status** | Draft v0.1, requires cryptographic review before implementation (R-10) |
| **Date** | 2026-11-13 |
| **Protocol version** | 1 |

This is a wire-format and behaviour specification. JSON blocks are message examples, not implementation code. Normative words (MUST, SHOULD) are used per RFC 2119.

---

## 1. Layers

```
Application message (typed JSON, inside ciphertext)
   ↑ sealed with directional AEAD key (§4)
Envelope (routing metadata, visible to relay)
   ↑
WebSocket over TLS (relay connection)  /  REST over TLS (tickets, revoke)
```

TLS protects against network attackers; **it does not protect against the relay**. End-to-end sealing (§4) does.

## 2. Envelope

Visible to the relay. Contains only routing and operational fields.

```json
{
  "v": 1,
  "msg_id": "01J...ULID",
  "from": "dev_laptop_01",
  "to": "dev_phone_01",
  "seq": 1042,
  "class": "interactive",
  "ttl_s": 300,
  "push": true,
  "nonce": "<24 bytes b64>",
  "ct": "<b64 ciphertext+tag>"
}
```

| Field | Rule |
|---|---|
| `v` | Protocol version. Relay and peers accept N and N-1 (NFR-10); otherwise BR-7001. |
| `msg_id` | ULID, unique per sender; used for ack/dedupe at relay. |
| `from`, `to` | Device ids. Relay MUST verify `from` equals the authenticated connection identity. |
| `seq` | Per-direction, per-peer, strictly increasing 64-bit counter. Bound into AAD (§4.3). |
| `class` | `interactive` (approval, action), `control` (presence, revoke), `ack`. The only message-type information revealed; finer type is inside `ct`. |
| `ttl_s` | Queue lifetime. Relay MUST NOT deliver after expiry. Max 600 for `interactive`. |
| `push` | Sender asks relay to send a content-free wake if the recipient is offline. |
| `nonce`, `ct` | AEAD nonce and ciphertext with tag. |

**Relay-visible metadata (accepted, documented):** sender/recipient ids, class, size, timing, whether a push was requested. Padding of `ct` to 256-byte multiples SHOULD be applied to blur size.

## 3. Application messages (inside `ct`)

All carry an inner header:

```json
{ "t": "<type>", "rid": "<request id>", "ts_sender": 1731480000, "body": { } }
```

`ts_sender` is informational only. **Expiry never relies on wall-clock agreement** (ADR-012).

### 3.1 `approval.request` (desktop → phone)

```json
{
  "t": "approval.request",
  "rid": "01J...",
  "body": {
    "digest": "<sha256 hex of canonical tool call, §3.6>",
    "tool": "run_command",
    "args": { "CommandLine": "npm test", "Cwd": "/work/proj" },
    "workspace": "/work/proj",
    "conversation": "ec33ebf9",
    "step": 19,
    "tier": 2,
    "tier_reasons": ["network", "outside_sandbox"],
    "remaining_ms": 300000,
    "model": "…"
  }
}
```

`remaining_ms` is the authority's remaining time at send; the phone counts down locally from receipt (ADR-012).

### 3.2 `approval.decision` (phone → desktop)

```json
{
  "t": "approval.decision",
  "rid": "01J...",
  "body": {
    "decision": "allow",
    "digest": "<sha256 hex computed by the PHONE from what it displayed>",
    "decided_remaining_ms": 212000,
    "sig": "<ECDSA P-256 over rid|digest|decision|device_id, per-use biometric key>"
  }
}
```

* `allow` MUST include `sig` (ADR-009). `deny` MAY omit it.
* The phone MUST compute `digest` itself from the decrypted displayed arguments, never copy the field from the request.

### 3.3 `approval.cancel` / `approval.expired` (desktop → phone)

`{ "reason": "expired" | "user_active_at_laptop" | "hook_disconnected" | "policy" }`. The phone removes the request from actionable UI and shows the reason. A decision arriving after these is dropped by the desktop (BR-2002) and audited.

### 3.4 `approval.receipt` (phone → desktop)

Sent when the request is rendered to the user (not merely received). Lets the desktop distinguish `DELIVERED` from `DISPLAYED` for diagnostics only; has no authority.

### 3.5 `action.request` / `action.result`

```json
{ "t": "action.request", "rid": "...", "body": { "action": "lock", "args": {} } }
{ "t": "action.result",  "rid": "...", "body": { "ok": true, "code": null, "info": {} } }
```

Registry in v1: `lock`, `status`. Anything else MUST be refused with BR-4003 and audited. Actions carry a 120 s validity; stale ones are discarded (TC-C-09).

### 3.6 Canonical digest

`digest = SHA-256( JCS( { tool, args, cwd, conversation, step, rid } ) )` where JCS is RFC 8785 JSON canonicalisation. Both sides compute it independently from their copy of the data. `cwd` is taken from `args.Cwd` if present, else the first workspace path.

### 3.7 `presence`, `revoke`, `rekey` (control)

* `presence`: `{state: "active"|"paused"|"safe", agent_version, antigravity_surfaces: [...]}` every 30 s ± 5 s jitter.
* `revoke`: `{ target_device, reason }`. Also sent via REST to the relay for enforcement.
* `rekey`: reserved for Phase 4 epoch rotation; v1 peers MUST ignore unknown control types without failing.

## 4. Cryptography

Algorithms are named so reviewers can check them; **do not implement primitives, use vetted libraries** (R-10, S-07).

### 4.1 Suite `BR-SUITE-1`

| Purpose | Choice |
|---|---|
| Key agreement | X25519 |
| Pairing handshake | Noise `XXpsk3_25519_ChaChaPoly_SHA256` with the QR secret as PSK |
| KDF | HKDF-SHA-256 |
| Message AEAD | XChaCha20-Poly1305, random 192-bit nonce |
| Device auth to relay | Ed25519 signatures |
| Decision authenticator | ECDSA P-256, Android Keystore key, per-use user authentication |
| Hash | SHA-256 |

Fallback if no maintained Noise library exists on a target (S-07): X25519 ephemeral DH + HKDF with the PSK, with both sides signing the transcript. Any fallback needs the same review.

### 4.2 Key hierarchy

```
pairing: Noise handshake → handshake hash h, chaining output
HKDF(out, "BR1 d2p") → k_d2p   (desktop → phone message key)
HKDF(out, "BR1 p2d") → k_p2d   (phone → desktop message key)
HKDF(h,   "BR1 SAS") → SAS (6 decimal digits)
```

Separate directional keys avoid cross-direction nonce/replay confusion.

### 4.3 AAD

`AAD = "BR1" | v | from | to | seq | class`. Any change by the relay breaks authentication (TC-S-11).

### 4.4 Replay and ordering

* Receiver stores `highest_seq` per peer+direction (persisted before processing).
* `seq ≤ highest_seq` → drop and audit as BR-2004 (also covers at-least-once redelivery).
* Gaps are allowed (expired or dropped messages); strictness is on monotonic increase.
* A sender MUST persist its counter before sending; after crash it MUST resume ≥ the persisted value.
* One active connection per device (ADR-013) so FIFO queue delivery cannot reorder.

### 4.5 Key rotation

v1: keys are static per pairing; compromise response is revoke + re-pair. Phase 4 adds epoch rekey by fresh ephemeral DH when both ends are online. Known limitation: no forward secrecy against a later compromise of a device's stored keys (accepted, T-17).

## 5. Pairing protocol

Preconditions: the desktop is already enrolled with the relay (operator enrollment token, ADR-011).

1. **Ticket.** Desktop authenticates to relay and requests a ticket (REST). Relay returns `ticket` (128-bit random), `expires_at` ≤ 5 min, single use. Desktop shows a QR containing: `{v, relay_url, ticket, desktop_id, desktop_e2e_pub_fp, psk, expires_at}`. `psk` is 128+ bits, generated per pairing, never sent to the relay.
2. **Redeem.** Phone scans, connects to the relay, redeems `ticket` presenting its new auth public key. Relay opens a short-lived pairing channel between the two devices; it forwards opaque handshake bytes.
3. **Handshake.** Noise XXpsk3 using `psk`. Phone verifies the desktop static key fingerprint against the QR value.
4. **SAS.** Both sides derive a 6-digit SAS and display it. The user MUST confirm equality on both devices. Mismatch aborts (BR-3003) and burns the ticket.
5. **Key exchange of auth keys.** Over the new encrypted channel, devices exchange: device ids, Ed25519 auth public keys, the phone's Keystore ECDSA decision public key, push token (phone → relay is separate, step 6).
6. **Bind.** Each device tells the relay (signed with its auth key) to bind the pair; relay records pairing. Phone registers its FCM token with the relay.
7. **Seal.** Ticket and PSK are destroyed. An audit entry is written on the desktop.

Failure handling: ticket expired (BR-3002), reused (BR-3002), wrong PSK (handshake fails → BR-3001), SAS mismatch (BR-3003), relay unreachable (BR-1001). Rate limit: 5 failed redeems per ticket window then the ticket is burned.

## 6. Relay authentication

* Device holds an Ed25519 key. On `WSS /v1/connect` the relay issues a random challenge; device signs `challenge | device_id | protocol_version`. Relay verifies against the stored public key. Failure → BR-1002 and close.
* Connections are short-lived sessions; reconnect re-authenticates. No long-lived bearer tokens (ADR-011).
* Revoked devices fail authentication with BR-7002.
* New desktop enrollment requires the operator enrollment token (held by the owner); phones enrol only through a valid ticket.

## 7. Desktop verification of a decision (all MUST pass)

Order matters; each failure is audited with its code and results in `RESOLVED_DEFER` for the pending request unless stated.

1. Envelope `from` is the paired phone and `v` supported (BR-7001/BR-1002).
2. `seq` is greater than `highest_seq` (BR-2004).
3. AEAD verifies with `k_p2d` and AAD (BR-3001; counts toward poison threshold, 05 §5).
4. `rid` refers to a request in `SENT` or `DELIVERED` (otherwise BR-2002, dropped).
5. Request deadline (desktop monotonic clock) not passed (BR-2002).
6. `digest` equals the desktop's own digest of the original call (BR-2003, treated as a security event).
7. If `decision = allow`: `sig` verifies against the registered decision public key over `rid|digest|decision|device_id` (BR-2005).
8. Request not already decided (single-use).

Only then `DECIDED`.

## 8. Delivery semantics

At-least-once at the relay; exactly-once effect at the desktop through (`rid`, single-use) and `seq` dedupe. Phone decisions are held in a persistent outbox and retried with backoff until acked or the request expires. See ADR-013.

## 9. Push

* Relay sends FCM data message: `{ "k": "wake", "mid": "<msg_id>" }`, high priority, TTL = remaining `ttl_s`. Nothing else. No command text, no tool name.
* Phone, on wake, MUST post a visible notification promptly (generic text "Approval needed") then connect, fetch, decrypt, and update it. Rationale: delivery priority and OS policies favour user-visible results [ASSUME, S-05].
* If the app was force-stopped, no push will arrive (platform behaviour); the UI documents this.

## 10. Rate limits and sizes

| Item | Limit | Error |
|---|---|---|
| Envelope | 64 KiB | BR-5003 |
| Requests per minute per device | 60 | BR-5001 |
| Queue depth per device | 100 | BR-5002 |
| Failed auths per IP/device per 10 min | 10 then exponential block | BR-1002 |

## 11. Error codes on the wire

Relay-originated errors use the envelope class `control` with plaintext `{code, retry_after_s?}` (never content). Full catalogue and handling: doc 05 §6.

## 12. Versioning

Additive fields allowed within a version; receivers ignore unknown fields. Breaking changes bump `v`. A peer receiving `v` outside N..N-1 replies BR-7001 and the UI shows an upgrade prompt.

## 13. Test vectors

Before M1 exit, publish deterministic test vectors for: canonical digest, HKDF label derivations, AEAD with fixed nonce, SAS derivation. Both the desktop and phone implementations MUST pass the same vectors (TC-U-01..05).