// 三档复习评分（贴合 5 岁儿童的简化反馈）
export type Grade = 'mastered' | 'fuzzy' | 'forgotten';

export const GRADE_LABELS: Record<Grade, string> = {
  mastered: '熟练',
  fuzzy: '略陌生',
  forgotten: '彻底陌生',
};

// 一个孩子的档案
export interface Child {
  id: string;
  name: string;
  createdAt: string;
}

// 录入的原始句子（保留语境）
export interface Sentence {
  id: string;
  childId: string;
  text: string;
  createdAt: string;
}

// 去重后的单词，附带 SM-2 记忆状态
export interface Word {
  id: string;
  childId: string;
  text: string; // 规范化后的小写词
  // 该词出现过的句子 id（用于复习时展示语境）
  sentenceIds: string[];
  firstLearnedAt: string;

  // AI 生成的例句（小学以内词汇）。生成后落库，复习时固定展示，
  // 用户可手动「换一句」重新生成覆盖。null 表示尚未生成。
  exampleSentence: string | null;

  // ---- 儿童版 SM-2 状态 ----
  interval: number; // 距离下次复习的天数
  ef: number; // 熟练度因子 ease factor
  repetitions: number; // 连续答对次数
  dueDate: string; // 下次复习日期 (YYYY-MM-DD)
  lastGrade: Grade | null;
  lastReviewedAt: string | null;
}

// 每次复习的日志（用于以后看进步曲线）
export interface ReviewLog {
  id: string;
  wordId: string;
  childId: string;
  grade: Grade;
  reviewedAt: string;
}
