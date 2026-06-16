import { useState } from 'react';
import { repo } from '../lib/db';
import { addLearning } from '../lib/wordService';
import { today } from '../lib/date';
import type { Lang } from '../lib/types';
import { LANG_LABELS } from '../lib/types';

// 模块1：录入今日学习的新内容（英文按词拆分 / 中文按字拆分）
export default function LearnInput({ childId, onChanged }: { childId: string; onChanged: () => void }) {
  const [lang, setLang] = useState<Lang>('en');
  const [text, setText] = useState('');
  const [learnedOn, setLearnedOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ newWords: string[]; reviewedExisting: string[] } | null>(null);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const r = await addLearning(repo, childId, trimmed, lang, learnedOn);
      setResult({ newWords: r.newWords, reviewedExisting: r.reviewedExisting });
      setText('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const unit = lang === 'zh' ? '字' : '单词';

  return (
    <div className="card">
      <h2>📝 录入新内容</h2>

      <div className="lang-switch">
        {(['en', 'zh'] as Lang[]).map((l) => (
          <button
            key={l}
            className={lang === l ? 'lang-btn active' : 'lang-btn'}
            onClick={() => {
              setLang(l);
              setResult(null);
            }}
          >
            {LANG_LABELS[l]}
          </button>
        ))}
      </div>

      <p className="hint">
        {lang === 'zh'
          ? '输入一句中文，应用会自动拆成单个汉字并开始跟踪记忆。'
          : '输入一句英文，应用会自动拆成单词并开始跟踪记忆。'}
      </p>

      <label className="field-label">学习日期</label>
      <input
        className="date-input"
        type="date"
        value={learnedOn}
        max={today()}
        onChange={(e) => setLearnedOn(e.target.value)}
      />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          lang === 'zh' ? '例如：小猫在床上睡觉。' : '例如：The cat is sleeping on the bed.'
        }
        rows={3}
      />

      <button onClick={handleSubmit} disabled={busy || !text.trim()}>
        {busy ? '处理中…' : `拆${unit}并保存`}
      </button>

      {result && (
        <div className="result">
          {result.newWords.length > 0 && (
            <p>
              ✅ 新增 {result.newWords.length} 个{unit}：
              {result.newWords.map((w) => (
                <span key={w} className="tag tag-new">{w}</span>
              ))}
            </p>
          )}
          {result.reviewedExisting.length > 0 && (
            <p>
              🔁 已学过的{unit}：
              {result.reviewedExisting.map((w) => (
                <span key={w} className="tag">{w}</span>
              ))}
            </p>
          )}
          {result.newWords.length === 0 && result.reviewedExisting.length === 0 && (
            <p>没有可识别的{unit}。</p>
          )}
        </div>
      )}
    </div>
  );
}
