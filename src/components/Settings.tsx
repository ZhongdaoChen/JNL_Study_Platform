// 配置页：集中放置应用级偏好设置（目前为复习倒计时时长）。
export default function Settings({ countdownSec, onCountdownChange }: {
  countdownSec: number;
  onCountdownChange: (sec: number) => void;
}) {
  return (
    <div className="card">
      <h2>⚙️ 配置</h2>

      <div className="countdown-config">
        <label className="field-label">复习倒计时（秒，0=关闭）</label>
        <input
          className="date-input"
          type="number"
          min={0}
          max={600}
          value={countdownSec}
          onChange={(e) => onCountdownChange(Number(e.target.value))}
        />
        <span className="hint">超时未评分将自动判为「彻底陌生」并跳到下一个。</span>
      </div>
    </div>
  );
}
