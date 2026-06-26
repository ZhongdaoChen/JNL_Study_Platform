const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SMALL_UNITS = ['', '十', '百', '千'];
const SECTION_UNITS = ['', '万', '亿', '兆'];

export function toChineseCount(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new Error('toChineseCount requires a safe integer');
  }
  if (value === 0) return DIGITS[0];
  if (value < 0) return `负${toChineseCount(Math.abs(value))}`;

  let n = value;
  let sectionIndex = 0;
  let result = '';
  let needZero = false;

  while (n > 0) {
    const section = n % 10000;
    if (section === 0) {
      if (result) needZero = true;
    } else {
      const sectionText = `${formatSection(section)}${SECTION_UNITS[sectionIndex]}`;
      result = `${sectionText}${needZero && result ? '零' : ''}${result}`;
      needZero = section < 1000;
    }
    n = Math.floor(n / 10000);
    sectionIndex += 1;
  }

  return result;
}

function formatSection(value: number): string {
  let n = value;
  let unitIndex = 0;
  let result = '';
  let needZero = false;

  while (n > 0) {
    const digit = n % 10;
    if (digit === 0) {
      if (result) needZero = true;
    } else {
      const zero = needZero ? DIGITS[0] : '';
      result = `${DIGITS[digit]}${SMALL_UNITS[unitIndex]}${zero}${result}`;
      needZero = false;
    }
    n = Math.floor(n / 10);
    unitIndex += 1;
  }

  return result.replace(/^一十/, '十');
}
