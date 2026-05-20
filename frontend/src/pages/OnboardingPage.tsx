import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function OnboardingPage() {
  const [inviteCode, setInviteCode] = useState('');
  const navigate = useNavigate();

  return (
    <main className="page">
      <h1>FPChat onboarding</h1>
      <div className="card">
        <input placeholder="Invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
        <button onClick={() => navigate('/register', { state: { inviteCode } })}>Continue</button>
      </div>
    </main>
  );
}