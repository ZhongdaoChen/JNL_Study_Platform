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
      '加入中文学习，录入页面选择中文即可。中文和英文会分开存放，在复习、总览页面也有对应选择。',
      '接入 AI 生成例句。',
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
