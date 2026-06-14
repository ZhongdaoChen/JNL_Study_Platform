import { useEffect, useState } from 'react';
import {
  getAdminUserStats,
  getAdminWords,
  getAdminFeedback,
  type AdminUserStat,
  type AdminWord,
  type AdminFeedback,
} from '../lib/admin';

// 管理员页面：跨用户总览（最后登录时间、录入单词、提交的建议）。
// 数据通过 security definer 的 RPC 获取，仅管理员邮箱能取到内容。
export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUserStat[]>([]);
  const [words, setWords] = useState<AdminWord[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [u, w, f] = await Promise.all([
          getAdminUserStats(),
          getAdminWords(),
          getAdminFeedback(),
        ]);
        if (!active) return;
        setUsers(u);
        setWords(w);
        setFeedback(f);
      } catch (e: any) {
        if (active) setError(e?.message || '加载失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <div className="card"><p>加载中…</p></div>;
  if (error) return <div className="card error-card">⚠️ {error}</div>;

  return (
    <>
      <div className="card">
        <h2>👤 注册用户（{users.length}）</h2>
        <p className="hint">时间为北京时间</p>
        <table className="word-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>最后登录</th>
              <th>注册</th>
              <th>英文</th>
              <th>中文</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>{u.email}</td>
                <td>{fmt(u.last_sign_in_at)}</td>
                <td>{fmt(u.created_at)}</td>
                <td>{u.en_count}</td>
                <td>{u.zh_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>📚 录入的单词 / 单字（{words.length}）</h2>
        {words.length === 0 ? (
          <p className="hint">暂无数据。</p>
        ) : (
          <table className="word-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>孩子</th>
                <th>语言</th>
                <th>内容</th>
                <th>连对</th>
                <th>下次复习</th>
              </tr>
            </thead>
            <tbody>
              {words.map((w, i) => (
                <tr key={i}>
                  <td>{w.email}</td>
                  <td>{w.child_name}</td>
                  <td>{w.lang === 'zh' ? '中' : '英'}</td>
                  <td>{w.word}</td>
                  <td>{w.repetitions}</td>
                  <td>{w.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>💡 用户建议（{feedback.length}）</h2>
        {feedback.length === 0 ? (
          <p className="hint">暂无建议。</p>
        ) : (
          <ul className="feedback-list">
            {feedback.map((f, i) => (
              <li key={i}>
                <div className="fb-meta">
                  <span className="fb-email">{f.email}</span>
                  <span className="cl-date">{fmt(f.created_at)}</span>
                </div>
                <div className="fb-content">{f.content}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// UTC 时间戳 → 北京时间字符串
function fmt(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
