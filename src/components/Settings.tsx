import { useState } from 'react';

// 配置页：集中放置应用级偏好设置（目前为复习倒计时时长）。
export default function Settings({ countdownSec, onCountdownChange }: {
  countdownSec: number;
  onCountdownChange: (sec: number) => void;
}) {
  // 用本地字符串管理输入，允许清空；空值视为关闭（0）。
  const [text, setText] = useState(countdownSec > 0 ? String(countdownSec) : '');

  function handleChange(v: string) {
    if (!/^\d*$/.test(v)) return; // 只允许数字或空
    setText(v);
    onCountdownChange(v === '' ? 0 : Number(v));
  }

  return (
    <div className="card">
      <h2>⚙️ 配置</h2>

      <div className="countdown-config">
        <label className="field-label">复习倒计时（秒，留空 = 关闭）</label>
        <input
          className="date-input"
          type="text"
          inputMode="numeric"
          placeholder="留空关闭"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
        />
        <span className="hint">超时未评分将自动判为「彻底陌生」并跳到下一个。</span>
      </div>
    </div>
  );
}
