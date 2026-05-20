# Crypto Flows

## 1:1 E2EE flow
1. Each user generates long-term identity key pair on device.
2. Registration uploads only public identity key.
3. Sender fetches recipient public key and derives shared secret (X25519).
4. Per-message symmetric key/nonce derived via HKDF.
5. Message plaintext encrypted on client (AES-GCM) to ciphertext+nonce.
6. Server stores ciphertext+nonce only, never plaintext.
7. Recipient derives same shared secret and decrypts locally.
8. Rotation strategy: per-session ephemeral prekeys (future extension).

## Encrypted media flow
1. Sender generates random attachment key per file.
2. File bytes encrypted on client (AES-GCM; unique nonce).
3. Upload only encrypted bytes + encrypted metadata envelope.
4. Server validates MIME/category/size and stores encrypted blob.
5. DB stores encrypted object path/hash only.
6. Recipient gets key via encrypted message payload envelope.
7. Client downloads encrypted blob and decrypts locally.

## Security guardrails
- Never log plaintext, keys, tokens, raw media.
- Verify file size and enforce safe server-side naming.
- Use refresh token rotation and session revocation.