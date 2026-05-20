import { openDB } from 'idb';

const dbPromise = openDB('fpchat-secure', 1, {
  upgrade(db) {
    db.createObjectStore('messages', { keyPath: 'id' });
  }
});

export async function cacheEncryptedMessage(message: { id: string; chatId: string; ciphertext: string; nonce: string }) {
  const db = await dbPromise;
  await db.put('messages', message);
}