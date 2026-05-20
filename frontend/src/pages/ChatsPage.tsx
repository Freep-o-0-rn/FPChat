import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuthStore } from '@/app/store/auth.store';
import { api } from '@/shared/api/client';

interface Chat {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null;
}

export function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const token = useAuthStore((s) => s.accessToken) ?? undefined;

  useEffect(() => {
    void api<Chat[]>('/chats', {}, token).then(setChats);
  }, [token]);

  return (
    <main className="page">
      <h1>Chats</h1>
      <Link to="/groups/create">Create group</Link>
      {chats.map((chat) => (
        <Link key={chat.id} to={`/chats/${chat.id}`} className="card" style={{ display: 'block' }}>
          {chat.title ?? chat.id}
        </Link>
      ))}
    </main>
  );
}