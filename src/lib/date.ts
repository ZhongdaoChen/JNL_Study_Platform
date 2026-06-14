// 日期工具：以本地日期的 YYYY-MM-DD 作为"天"的单位
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toDateStr(new Date());
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

// a <= b ?
export function dateLte(a: string, b: string): boolean {
  return a <= b; // YYYY-MM-DD 字符串可直接比较
}
