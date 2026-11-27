import { DocMeta } from './storage';

/** Tags offered before the user creates their own. */
export const DEFAULT_TAGS = ['רכב', 'בריאות', 'ביטוח', 'בית', 'כספים', 'עבודה', 'לימודים', 'אחריות'];

/** All tags: the defaults plus every tag in use, most used first. */
export function allTags(meta: Record<string, DocMeta>): { tag: string; count: number }[] {
  const count = new Map<string, number>();
  DEFAULT_TAGS.forEach((t) => count.set(t, 0));
  Object.values(meta).forEach((m) => (m.tags ?? []).forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)));
  return [...count.entries()].map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count);
}

export interface PersonalSlot {
  key: string;
  label: string;
  icon: string;
  expires: boolean; // the document has an expiry date
  yearly?: boolean; // renewed every year
}

/** The "personal file": the documents most people need to have at hand. */
export const PERSONAL_SLOTS: PersonalSlot[] = [
  { key: 'id', label: 'תעודת זהות', icon: '🪪', expires: true },
  { key: 'idAppendix', label: 'ספח תעודת זהות', icon: '📄', expires: false },
  { key: 'license', label: 'רישיון נהיגה', icon: '🚗', expires: true },
  { key: 'passport', label: 'דרכון', icon: '🛂', expires: true },
  { key: 'carLicense', label: 'רישיון רכב', icon: '🚙', expires: true, yearly: true },
  { key: 'carInsurance', label: 'ביטוח רכב', icon: '🛡️', expires: true, yearly: true },
  { key: 'healthCard', label: 'כרטיס קופת חולים', icon: '🏥', expires: false },
  { key: 'homeInsurance', label: 'ביטוח דירה', icon: '🏠', expires: true, yearly: true },
];

export const slotOf = (key?: string) => PERSONAL_SLOTS.find((s) => s.key === key);

/** The same day one year later (29/2 → 28/2). */
export function addYear(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y + 1, m - 1, d);
  if (dt.getMonth() !== m - 1) dt.setDate(0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export type DateFilter = 'all' | 'week' | 'month' | 'year' | 'older';
export const DATE_FILTERS: [DateFilter, string][] = [
  ['all', 'כל התאריכים'],
  ['week', 'שבוע אחרון'],
  ['month', 'חודש אחרון'],
  ['year', 'שנה אחרונה'],
  ['older', 'ישן משנה'],
];

/** Does a file's modification time pass the date filter? (unknown dates pass only "all") */
export function passesDate(f: DateFilter, modified: number): boolean {
  if (f === 'all') return true;
  if (!modified) return false;
  const age = Date.now() - modified;
  const day = 86_400_000;
  if (f === 'week') return age <= 7 * day;
  if (f === 'month') return age <= 31 * day;
  if (f === 'year') return age <= 365 * day;
  return age > 365 * day;
}
