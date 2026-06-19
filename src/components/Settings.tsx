import { useEffect, useState } from 'react';
import { shareDataToEmail } from '../lib/dataShare';

export default function Settings({
  countdownSec,
  onCountdownChange,
  dailyLimits,
  onDailyLimitChange,
  onSaveConfig,
  saveBusy,
  saveMsg,
  cloudEnabled,
}: {
  countdownSec: number;
  onCountdownChange: (sec: number) => void;
  dailyLimits: {
    'en-read': number;
    'en-spell': number;
    'zh-read': number;
    'zh-write': number;
  };
  onDailyLimitChange: (mode: 'en-read' | 'en-spell' | 'zh-read' | 'zh-write', sec: number) => void;
  onSaveConfig: () => Promise<void>;
  saveBusy: boolean;
  saveMsg: string | null;
  cloudEnabled: boolean;
}) {
  // 用本地字符串管理输入，允许清空；空值视为关闭/不限（0）。
  const [countdownText, setCountdownText] = useState(countdownSec > 0 ? String(countdownSec) : '');
  const [limitText, setLimitText] = useState({
    'en-read': dailyLimits['en-read'] > 0 ? String(dailyLimits['en-read']) : '',
    'en-spell': dailyLimits['en-spell'] > 0 ? String(dailyLimits['en-spell']) : '',
    'zh-read': dailyLimits['zh-read'] > 0 ? String(dailyLimits['zh-read']) : '',
    'zh-write': dailyLimits['zh-write'] > 0 ? String(dailyLimits['zh-write']) : '',
  });
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    setCountdownText(countdownSec > 0 ? String(countdownSec) : '');
    setLimitText({
      'en-read': dailyLimits['en-read'] > 0 ? String(dailyLimits['en-read']) : '',
      'en-spell': dailyLimits['en-spell'] > 0 ? String(dailyLimits['en-spell']) : '',
      'zh-read': dailyLimits['zh-read'] > 0 ? String(dailyLimits['zh-read']) : '',
      'zh-write': dailyLimits['zh-write'] > 0 ? String(dailyLimits['zh-write']) : '',
    });
  }, [countdownSec, dailyLimits]);

  function handleCountdownChange(v: string) {
    if (!/^\d*$/.test(v)) return;
    setCountdownText(v);
    onCountdownChange(v === '' ? 0 : Number(v));
  }

  function handleLimitChange(mode: 'en-read' | 'en-spell' | 'zh-read' | 'zh-write', v: string) {
    if (!/^\d*$/.test(v)) return;
    setLimitText((prev) => ({ ...prev, [mode]: v }));
    onDailyLimitChange(mode, v === '' ? 0 : Number(v));
  }

  async function handleShare() {
    const email = shareEmail.trim();
    if (!email) return;
    if (!confirm(`确认将当前账户的学习数据共享给 ${email} 吗？对方会取并集去重，你自己的数据不变。`)) return;
    setShareBusy(true);
    setShareMsg(null);
    try {
      const result = await shareDataToEmail(email);
      setShareMsg(
        `共享完成：新建孩子 ${result.created_children} 个，新增句子 ${result.inserted_sentences} 条，合并单词 ${result.upserted_words} 个，新增复习记录 ${result.inserted_logs} 条。`,
      );
      setShareEmail('');
    } catch (e: any) {
      setShareMsg(`共享失败：${e?.message || '请稍后重试'}`);
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>⚙️ 配置</h2>

      <div className="countdown-config">
        <label className="field-label">复习倒计时（秒，留空 = 关闭）</label>
        <div className="config-inline">
          <input
            className="date-input config-number-input"
            type="text"
            inputMode="numeric"
            placeholder="留空关闭"
            value={countdownText}
            onChange={(e) => handleCountdownChange(e.target.value)}
          />
          <span className="hint">超时未评分将自动判为「彻底陌生」并跳到下一个。</span>
        </div>
      </div>

      <div className="countdown-config">
        <label className="field-label">英文读每天最大个数（留空 = 不限）</label>
        <input
          className="date-input config-number-input"
          type="text"
          inputMode="numeric"
          placeholder="留空不限"
          value={limitText['en-read']}
          onChange={(e) => handleLimitChange('en-read', e.target.value)}
        />
      </div>

      <div className="countdown-config">
        <label className="field-label">英文拼每天最大个数（留空 = 不限）</label>
        <input
          className="date-input config-number-input"
          type="text"
          inputMode="numeric"
          placeholder="留空不限"
          value={limitText['en-spell']}
          onChange={(e) => handleLimitChange('en-spell', e.target.value)}
        />
      </div>

      <div className="countdown-config">
        <label className="field-label">中文读每天最大个数（留空 = 不限）</label>
        <input
          className="date-input config-number-input"
          type="text"
          inputMode="numeric"
          placeholder="留空不限"
          value={limitText['zh-read']}
          onChange={(e) => handleLimitChange('zh-read', e.target.value)}
        />
      </div>

      <div className="countdown-config">
        <label className="field-label">中文写每天最大个数（留空 = 不限）</label>
        <input
          className="date-input config-number-input"
          type="text"
          inputMode="numeric"
          placeholder="留空不限"
          value={limitText['zh-write']}
          onChange={(e) => handleLimitChange('zh-write', e.target.value)}
        />
      </div>

      <div className="countdown-config">
        <button className="settings-save-btn" onClick={() => void onSaveConfig()} disabled={saveBusy}>
          {saveBusy ? '提交配置中…' : '提交配置'}
        </button>
        <span className="hint">
          {cloudEnabled ? '提交后会落库，并在该用户的其他设备登录时自动生效。' : '当前是本地模式，提交配置不会同步到其他设备。'}
        </span>
        {saveMsg && <p className="hint">{saveMsg}</p>}
      </div>

      <div className="countdown-config">
        <label className="field-label">数据共享账户</label>
        <div className="config-inline">
          <input
            className="share-email-input"
            type="email"
            placeholder="输入对方已注册邮箱"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
          />
          <button className="share-btn" onClick={handleShare} disabled={shareBusy || !shareEmail.trim()}>
            {shareBusy ? '推送中…' : '数据推送'}
          </button>
        </div>
        <span className="hint">共享后，对方账户会合并你的孩子、句子、单词和复习记录（去重），你自己的数据不变。</span>
        {shareMsg && <p className="hint">{shareMsg}</p>}
      </div>
    </div>
  );
}
