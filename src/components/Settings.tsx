import { useState } from 'react';

export default function Settings({
  countdownSec,
  onCountdownChange,
  dailyLimits,
  onDailyLimitChange,
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
}) {
  // 用本地字符串管理输入，允许清空；空值视为关闭/不限（0）。
  const [countdownText, setCountdownText] = useState(countdownSec > 0 ? String(countdownSec) : '');
  const [limitText, setLimitText] = useState({
    'en-read': dailyLimits['en-read'] > 0 ? String(dailyLimits['en-read']) : '',
    'en-spell': dailyLimits['en-spell'] > 0 ? String(dailyLimits['en-spell']) : '',
    'zh-read': dailyLimits['zh-read'] > 0 ? String(dailyLimits['zh-read']) : '',
    'zh-write': dailyLimits['zh-write'] > 0 ? String(dailyLimits['zh-write']) : '',
  });

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
    </div>
  );
}
