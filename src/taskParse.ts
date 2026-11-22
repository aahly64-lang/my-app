// Understands Hebrew date/time words in a quick task: "להתקשר לספק מחר ב-10" -> due tomorrow, reminder 10:00.

const DAY_NAMES: [RegExp, number][] = [
  [/ראשון|א'/, 0],
  [/שני|ב'/, 1],
  [/שלישי|ג'/, 2],
  [/רביעי|ד'/, 3],
  [/חמישי|ה'/, 4],
  [/שישי|ו'/, 5],
  [/שבת/, 6],
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface Parsed {
  title: string;
  due?: string;
  time?: string; // HH:MM
}

export function parseQuickTask(text: string, now = new Date()): Parsed {
  let t = ` ${text} `;
  let due: string | undefined;
  let time: string | undefined;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const take = (re: RegExp) => {
    const m = re.exec(t);
    if (m) t = t.replace(m[0], ' ');
    return m;
  };

  // time: "בשעה 10:30", "ב-10", "ב10", "10:30", "ב 9 בערב"
  let m =
    take(/\s(?:בשעה\s*|ב-?\s?)(\d{1,2})(?::(\d{2}))?(\s*(?:בערב|בלילה|אחה"צ|אחר הצהריים|בבוקר))?(?=\s)/) ||
    take(/\s(\d{1,2}):(\d{2})(\s*(?:בערב|בלילה|בבוקר))?(?=\s)/);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const part = m[3] ?? '';
    if (/ערב|לילה|אחה|אחר/.test(part) && h < 12) h += 12;
    if (h <= 23 && min <= 59) time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  // date words
  if (take(/\sמחרתיים(?=\s)/)) due = ymd(new Date(base.getTime() + 2 * 864e5));
  else if (take(/\sמחר(?=\s)/)) due = ymd(new Date(base.getTime() + 864e5));
  else if (take(/\s(?:היום|הערב)(?=\s)/)) due = ymd(base);
  else if (take(/\s(?:בשבוע הבא|שבוע הבא)(?=\s)/)) due = ymd(new Date(base.getTime() + 7 * 864e5));
  else {
    const d = take(/\s(?:ב-?)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/);
    if (d) {
      let y = d[3] ? Number(d[3]) : base.getFullYear();
      if (y < 100) y += 2000;
      const cand = new Date(y, Number(d[2]) - 1, Number(d[1]));
      if (!d[3] && cand < base) cand.setFullYear(cand.getFullYear() + 1);
      if (!Number.isNaN(cand.getTime())) due = ymd(cand);
    } else {
      const w = /\s(?:ביום|יום)\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|[א-ו]')(?=\s)/.exec(t) || /\sבשבת(?=\s)/.exec(t);
      if (w) {
        const word = w[1] ?? 'שבת';
        const dayIdx = DAY_NAMES.find(([re]) => re.test(word))?.[1];
        if (dayIdx !== undefined) {
          t = t.replace(w[0], ' ');
          let add = (dayIdx - base.getDay() + 7) % 7;
          if (add === 0) add = 7;
          due = ymd(new Date(base.getTime() + add * 864e5));
        }
      }
    }
  }

  // a time without a date: today, or tomorrow if that hour already passed
  if (time && !due) {
    const [h, mi] = time.split(':').map(Number);
    const at = new Date(base);
    at.setHours(h, mi);
    due = ymd(at.getTime() <= now.getTime() ? new Date(base.getTime() + 864e5) : base);
  }

  const title = t.replace(/\s+/g, ' ').trim();
  return { title: title || text.trim(), due, time };
}
