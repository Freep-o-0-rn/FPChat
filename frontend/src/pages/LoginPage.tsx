import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/app/store/auth.store';
import { api } from '@/shared/api/client';

export function LoginPage() {
  const [nickname, setNickname] = useState('@');
  const [password, setPassword] = useState('');
  const setTokens = useAuthStore((s) => s.setTokens);
  const navigate = useNavigate();

  const submit = async () => {
    const res = await api<{ accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ nickname, password })
    });
    setTokens(res);
    navigate('/chats');
  };

  return (
    <main className="page">
      <h1>Login</h1>
      <div className="card">
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="@nickname" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
        <button onClick={submit}>Login</button>
        <Link to="/register">Register</Link>
      </div>
    </main>
  );
}