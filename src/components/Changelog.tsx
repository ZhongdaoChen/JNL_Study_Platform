import { useState } from 'react';
import { CHANGELOG } from '../lib/changelog';
import { repo } from '../lib/db';

// 页面底部的「版本更新」框：默认展示最新一版，可展开查看历史。
// 末尾附带一个反馈输入框，收集用户建议/需求，写入独立的 feedback 表。
export default function Changelog() {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitFeedback() {
    const content = feedback.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      await repo.addFeedback(content);
      setFeedback('');
      setSent(true);
    } catch (e: any) {
      setError(e?.message || '提交失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  const shown = expanded ? CHANGELOG : CHANGELOG.slice(0, 1);

  return (
    <section className="changelog">
      <div className="changelog-head">
        <h3>📣 版本更新</h3>
        {CHANGELOG.length > 1 && (
          <button className="link-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '查看历史'}
          </button>
        )}
      </div>

      {shown.map((e) => (
        <div key={e.version} className="changelog-entry">
          <div className="changelog-version">
            <span className="cl-tag">{e.version}</span>
            <span className="cl-date">{e.date}</span>
          </div>
          <ul>
            {e.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      ))}

      <div className="feedback-box">
        <h4>💡 你的建议 / 想要的功能</h4>
        <textarea
          value={feedback}
          onChange={(e) => {
            setFeedback(e.target.value);
            setSent(false);
          }}
          placeholder="告诉我们你希望增加的功能或使用中的问题…"
          rows={3}
        />
        <button onClick={submitFeedback} disabled={busy || !feedback.trim()}>
          {busy ? '提交中…' : '提交建议'}
        </button>
        {sent && <p className="feedback-ok">✅ 已收到，谢谢你的建议！</p>}
        {error && <p className="example-error">{error}</p>}
      </div>
    </section>
  );
}
