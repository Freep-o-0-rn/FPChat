import { useState } from 'react';

import { useAuthStore } from '@/app/store/auth.store';
import { api } from '@/shared/api/client';

export function GroupCreatePage() {
  const [title, setTitle] = useState('');
  const token = useAuthStore((s) => s.accessToken) ?? undefined;

  const create = async () => {
    await api('/groups', { method: 'POST', body: JSON.stringify({ title, memberIds: [] }) }, token);
  };

  return (
    <main className="page">
      <h1>Create group</h1>
      <div className="card">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group name" />
        <button onClick={create}>Create</button>
      </div>
    </main>
  );
}