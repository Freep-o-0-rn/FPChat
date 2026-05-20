import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuthStore } from '@/app/store/auth.store';
import { api } from '@/shared/api/client';
import { cacheEncryptedMessage } from '@/shared/idb/secure-cache';

interface Message {
  id: string;
  ciphertext: string;
  nonce: string;
}

export function ChatPage() {
  const { chatId = '' } = useParams();
  const token = useAuthStore((s) => s.accessToken) ?? undefined;
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    void api<Message[]>(`/messages?chatId=${chatId}`, {}, token).then((items) => {
      setMessages(items);
      void Promise.all(items.map((message) => cacheEncryptedMessage({ ...message, chatId })));
    });
  }, [chatId, token]);

  return (
    <main className="page">
      <h1>Chat</h1>
      {messages.map((m) => (
        <div key={m.id} className="card">encrypted: {m.ciphertext.slice(0, 16)}...</div>
      ))}
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Encrypted message draft" />
    </main>
  );
}