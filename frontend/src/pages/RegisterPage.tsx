import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { api } from '@/shared/api/client';
import { useAuthStore } from '@/app/store/auth.store';

export function RegisterPage() {
  const location = useLocation();
  const [inviteCode, setInviteCode] = useState(location.state?.inviteCode ?? '');
  const [nickname, setNickname] = useState('@');
  const [password, setPassword] = useState('');
  const setTokens = useAuthStore((s) => s.setTokens);
  const navigate = useNavigate();

  const submit = async () => {
    const res = await api<{ accessToken: string; refreshToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ inviteCode, nickname, password, identityPublicKey: 'A'.repeat(43) })
    });
    setTokens(res);
    navigate('/chats');
  };

  return (
    <main className="page">
      <h1>Create account</h1>
      <div className="card">
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Invite code" />
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="@nickname" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
        <button onClick={submit}>Register</button>
        <Link to="/login">Login</Link>
      </div>
    </main>
  );
}