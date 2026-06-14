import { useState } from 'react';
import { CHANGELOG } from '../lib/changelog';

// 页面底部的「版本更新」框：默认展示最新一版，可展开查看历史。
export default function Changelog() {
  const [expanded, setExpanded] = useState(false);
  if (CHANGELOG.length === 0) return null;

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
    </section>
  );
}
