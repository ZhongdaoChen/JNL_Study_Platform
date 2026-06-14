// 版本更新日志。新增更新时在数组最前面插入一条即可。
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v1.2.0',
    date: '2026-06-14',
    items: [
      '新增中文学习：可录入中文并按单字拆分跟踪记忆',
      '复习、总览模块新增「英文 / 中文」切换标签',
      '页面底部新增版本更新记录',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-06-14',
    items: [
      '复习时「看例句提示」接入 AI，自动生成儿童例句并保存',
      '新增「换一句」按钮，可重新生成不满意的例句',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-06-13',
    items: [
      '上线录入、复习、总览、统计四大模块',
      '儿童版记忆曲线（SM-2）智能安排复习',
      '支持多设备云端同步与本地存储',
    ],
  },
];
