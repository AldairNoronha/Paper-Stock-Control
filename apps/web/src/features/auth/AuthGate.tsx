import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type { RuntimeConfig } from '../../lib/runtime';

interface AuthGateProps {
  config: RuntimeConfig;
  children: (accessToken: string, signOut: () => Promise<void>) => ReactNode;
}

export function AuthGate({ config, children }: AuthGateProps) {
  const client = useMemo(
    () => createClient(config.supabaseUrl, config.supabasePublishableKey),
    [config]
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) setError('Não foi possível entrar. Confira e-mail, senha e acesso liberado.');
    setSubmitting(false);
  }

  if (loading) return <div className="auth-card">Verificando sessão…</div>;
  if (!session) {
    return (
      <form className="auth-card" onSubmit={signIn}>
        <p className="eyebrow">ACESSO OPERACIONAL</p>
        <h2>Entrar para receber pallets</h2>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="message-panel danger" role="alert">{error}</div>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    );
  }
  return children(session.access_token, async () => {
    await client.auth.signOut();
  });
}
