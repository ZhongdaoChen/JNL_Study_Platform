import { useEffect, useState, type ReactNode } from 'react';
import { supabase, usingCloud } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

// 登录门：云端模式下要求登录后才能使用；本地模式直接放行。
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // 注册/登录表单状态
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!usingCloud || !supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 本地模式：无需登录
  if (!usingCloud) return <>{children}</>;

  if (!ready) return <div className="card"><p>加载中…</p></div>;

  // 已登录
  if (session) {
    return (
      <>
        <div className="auth-bar">
          <span className="auth-email">{session.user.email}</span>
          <button className="signout" onClick={() => supabase!.auth.signOut()}>
            退出登录
          </button>
        </div>
        {children}
      </>
    );
  }

  // 未登录：展示登录/注册表单
  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'signup') {
        const { error } = await supabase!.auth.signUp({ email, password });
        if (error) throw error;
        setMsg('注册成功！如开启了邮箱验证，请查收邮件后再登录。');
      } else {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      setMsg('出错了：' + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <h2>{mode === 'signin' ? '登录' : '注册'}</h2>
      <p className="hint">用邮箱登录后，数据会在你所有设备间同步。</p>
      <input
        type="email"
        placeholder="邮箱"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="密码（至少 6 位）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button onClick={submit} disabled={busy || !email || password.length < 6}>
        {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
      </button>
      <button
        className="link-btn"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setMsg(null);
        }}
      >
        {mode === 'signin' ? '没有账号？去注册' : '已有账号？去登录'}
      </button>
      {msg && <p className="auth-msg">{msg}</p>}
    </div>
  );
}
