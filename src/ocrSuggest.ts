/**
 * Suggestions from the text of a scan (read on the phone): a file name and an expiry date.
 * Everything here is a guess the user confirms.
 */

export interface OcrSuggestion {
  name?: string; // suggested file name (without extension)
  expiry?: string; // YYYY-MM-DD
  expiryByKeyword?: boolean; // found next to "בתוקף עד" / "expiry"… (more reliable)
  slot?: string; // personal-file slot key
  tag?: string;
}

interface Kind {
  words: RegExp;
  name: string;
  slot?: string;
  tag?: string;
  dated?: boolean; // add month/year to the name (bills, payslips)
}

const KINDS: Kind[] = [
  { words: /דרכון|passport/i, name: 'דרכון', slot: 'passport' },
  { words: /רישיון\s*נהיגה|רשיון\s*נהיגה|driving\s*licen[cs]e/i, name: 'רישיון נהיגה', slot: 'license', tag: 'רכב' },
  { words: /רישיון\s*רכב|רשיון\s*רכב/, name: 'רישיון רכב', slot: 'carLicense', tag: 'רכב' },
  { words: /ספח/, name: 'ספח תעודת זהות', slot: 'idAppendix' },
  { words: /תעודת\s*זהות|identity\s*card/i, name: 'תעודת זהות', slot: 'id' },
  { words: /ביטוח\s*(חובה|מקיף|רכב)|פוליס[הת]\s*(לרכב|רכב)|ביטוח\s*צד\s*ג/, name: 'ביטוח רכב', slot: 'carInsurance', tag: 'ביטוח' },
  { words: /ביטוח\s*(דירה|מבנה|תכולה)/, name: 'ביטוח דירה', slot: 'homeInsurance', tag: 'ביטוח' },
  { words: /ביטוח\s*בריאות/, name: 'ביטוח בריאות', tag: 'ביטוח' },
  { words: /ביטוח\s*חיים/, name: 'ביטוח חיים', tag: 'ביטוח' },
  { words: /קופת\s*חולים|מכבי|כללית|מאוחדת|לאומית/, name: 'קופת חולים', tag: 'בריאות' },
  { words: /מרשם|prescription/i, name: 'מרשם', tag: 'בריאות' },
  { words: /הפני[יה]ה/, name: 'הפניה', tag: 'בריאות' },
  { words: /תלוש\s*(שכר|משכורת)/, name: 'תלוש שכר', tag: 'עבודה', dated: true },
  { words: /חברת\s*החשמל|חשבון\s*חשמל/, name: 'חשבון חשמל', tag: 'בית', dated: true },
  { words: /חשבון\s*מים|תאגיד\s*מים/, name: 'חשבון מים', tag: 'בית', dated: true },
  { words: /ארנונה/, name: 'ארנונה', tag: 'בית', dated: true },
  { words: /תעודת\s*אחריות|אחריות\s*ל/, name: 'תעודת אחריות', tag: 'אחריות' },
  { words: /חשבונית|קבלה|receipt|invoice/i, name: 'קבלה', tag: 'כספים', dated: true },
  { words: /חוזה|הסכם\s*שכירות|הסכם/, name: 'חוזה' },
  { words: /תעודת\s*(בגרות|סיום)|גיליון\s*ציונים|diploma/i, name: 'תעודה', tag: 'לימודים' },
];

const EXPIRY_WORDS = /בתוקף\s*עד|תוקף|תאריך\s*פקיעה|פג\s*תוקף|עד\s*תאריך|תום\s*(תקופת\s*)?הביטוח|valid\s*(until|thru|through)|expir|date\s*of\s*expiry|exp\b/i;

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** All dates in a line, as YYYY-MM-DD (dd/mm/yyyy, dd.mm.yy, yyyy-mm-dd…). */
function datesIn(line: string): string[] {
  const out: string[] = [];
  const t = line.replace(/[Oo]/g, '0');
  for (const m of t.matchAll(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)) push(+m[1], +m[2], +m[3]);
  for (const m of t.matchAll(/(^|\D)(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/g)) {
    let y = +m[4];
    if (m[4].length === 2) y += y > 70 ? 1900 : 2000;
    push(y, +m[3], +m[2]);
  }
  return out;
  function push(y: number, mo: number, d: number) {
    if (y < 1950 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return;
    out.push(`${y}-${pad(mo)}-${pad(d)}`);
  }
}

export function suggestFromText(text: string | null | undefined): OcrSuggestion {
  const res: OcrSuggestion = {};
  if (!text) return res;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const all = lines.join('\n');

  // ---- what kind of document
  const kind = KINDS.find((k) => k.words.test(all));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYmd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  // ---- expiry: a date on (or right after) a line with an expiry word
  let byWord: string | undefined;
  for (let i = 0; i < lines.length && !byWord; i++) {
    if (!EXPIRY_WORDS.test(lines[i])) continue;
    const near = [...datesIn(lines[i]), ...(lines[i + 1] ? datesIn(lines[i + 1]) : [])];
    // "valid from … until …": the latest one on the line
    if (near.length) byWord = near.sort().pop();
  }
  const dates = lines.flatMap(datesIn).sort();
  if (byWord) {
    res.expiry = byWord;
    res.expiryByKeyword = true;
  } else if (kind?.slot && ['passport', 'license', 'carLicense', 'id', 'carInsurance', 'homeInsurance'].includes(kind.slot)) {
    // documents that expire: the latest future date is usually the expiry
    const future = dates.filter((d) => d >= todayYmd);
    if (future.length) res.expiry = future[future.length - 1];
  }

  // ---- name
  if (kind) {
    res.slot = kind.slot;
    res.tag = kind.tag;
    let name = kind.name;
    if (kind.dated) {
      const past = dates.filter((d) => d <= todayYmd);
      const d = past[past.length - 1];
      if (d) name += ` ${MONTHS_HE[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
    }
    res.name = name;
  } else {
    // the first line that looks like a title: mostly letters, not too short or long
    const title = lines.find((l) => {
      const letters = (l.match(/[֐-׿a-zA-Z]/g) ?? []).length;
      return l.length >= 4 && l.length <= 40 && letters / l.length > 0.6;
    });
    if (title) res.name = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  }
  return res;
}
