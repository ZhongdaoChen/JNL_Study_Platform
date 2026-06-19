import { useState } from 'react';
import { repo } from '../lib/db';
import { addLearning } from '../lib/wordService';
import { today } from '../lib/date';
import type { Lang } from '../lib/types';
import { LANG_LABELS } from '../lib/types';
import { tokenizeByLang } from '../lib/tokenizer';

// 模块1：录入今日学习的新内容（英文按词拆分 / 中文按字拆分）
export default function LearnInput({ childId, onChanged }: { childId: string; onChanged: () => void }) {
  const [lang, setLang] = useState<Lang>('en');
  const [text, setText] = useState('');
  const [learnedOn, setLearnedOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [previewWords, setPreviewWords] = useState<string[] | null>(null);
  const [result, setResult] = useState<{ newWords: string[]; reviewedExisting: string[] } | null>(null);

  function resetDraft(clearText = false) {
    setPreviewWords(null);
    setResult(null);
    if (clearText) setText('');
  }

  function handlePreview() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setResult(null);
    setPreviewWords(tokenizeByLang(trimmed, lang));
  }

  async function handleConfirm() {
    if (!previewWords || previewWords.length === 0) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const r = await addLearning(repo, childId, trimmed, lang, learnedOn, previewWords);
      setResult({ newWords: r.newWords, reviewedExisting: r.reviewedExisting });
      setPreviewWords(null);
      setText('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function removePreviewWord(word: string) {
    setPreviewWords((prev) => {
      if (!prev) return null;
      const next = prev.filter((item) => item !== word);
      return next.length > 0 ? next : null;
    });
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
              resetDraft();
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
        onChange={(e) => {
          setLearnedOn(e.target.value);
          setResult(null);
        }}
      />

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreviewWords(null);
          setResult(null);
        }}
        placeholder={
          lang === 'zh' ? '例如：小猫在床上睡觉。' : '例如：The cat is sleeping on the bed.'
        }
        rows={3}
      />

      {!previewWords ? (
        <button onClick={handlePreview} disabled={busy || !text.trim()}>
          {`先拆${unit}`}
        </button>
      ) : (
        <div className="learn-preview-area">
          <p className="hint">先确认要保留哪些{unit}，点右上角 × 可以删除。</p>
          <div className="learn-preview-grid">
            {previewWords.map((word) => (
              <div key={word} className="learn-preview-card">
                <button
                  type="button"
                  className="learn-preview-remove"
                  onClick={() => removePreviewWord(word)}
                  title={`删除${unit} ${word}`}
                >
                  ×
                </button>
                <span>{word}</span>
              </div>
            ))}
          </div>
          <div className="learn-preview-actions">
            <button className="learn-preview-confirm" onClick={handleConfirm} disabled={busy || previewWords.length === 0}>
              {busy ? '正在写入数据库…' : `确认写入 ${previewWords.length} 个${unit}`}
            </button>
          </div>
          {busy && <p className="hint">正在写入数据库，请稍等…</p>}
        </div>
      )}

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
