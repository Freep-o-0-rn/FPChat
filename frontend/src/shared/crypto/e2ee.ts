export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return window.crypto.subtle.generateKey(
    {
      name: 'X25519'
    },
    true,
    ['deriveKey']
  );
}

export async function encryptText(plain: string, key: CryptoKey): Promise<{ ciphertext: string; nonce: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    nonce: btoa(String.fromCharCode(...iv))
  };
}

export async function encryptMedia(bytes: ArrayBuffer, key: CryptoKey): Promise<{ encrypted: ArrayBuffer; nonce: string }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { encrypted, nonce: btoa(String.fromCharCode(...iv)) };
}