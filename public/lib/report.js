/* ============================================================
 * Genograph - printable report (pure, no DOM)
 *
 * Builds the HTML of a print-only report of the current tree view: the people
 * the layout placed, one section per generation, in the order their cards are
 * drawn. Labels come from the caller's translate function so the report
 * follows the UI language.
 *
 * Imported both by the browser app and by the Node test suite.
 * ============================================================ */
'use strict';

import { birthSortIds, yearOf, ageOf, MAX_LIVING_AGE } from './model.js';
import { PITCH } from './layout.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Whether a person should be treated as living: not marked deceased, no death
 * date, and either no birth year or one recent enough to still be alive.
 */
export function isLiving(p, today = new Date()) {
  if (p.deceased || p.death_date) return false;
  const y = yearOf(p.birth_date);
  return !y || today.getFullYear() - Number(y) <= MAX_LIVING_AGE;
}

/** A structured date as genealogists write it ("18 Jul 1194", "Jul 1194", "1194"); other text passes through. */
export function formatDate(value, lang = 'en') {
  const m = /^(\d{4})(?:\.(\d{2}))?(?:\.(\d{2}))?$/.exec(String(value ?? ''));
  if (!m) return String(value ?? '');
  const [, y, mo, d] = m;
  if (!mo) return y;
  if (+mo < 1 || +mo > 12) return String(value);
  const month = new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, +mo - 1, 1)));
  return [d ? String(+d) : '', month.replace(/\.$/, ''), y].filter(Boolean).join(' ');
}

/**
 * The placed cards grouped into generation rows, top (oldest) first, each row
 * left to right. `gen` counts generations above the focus person (negative below).
 */
export function generationRows(cards, focusId) {
  const seen = new Set(), rows = new Map();
  const focusY = cards.find(c => c.id === focusId)?.y ?? 0;
  for (const c of [...cards].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const gen = Math.round((focusY - c.y) / PITCH);
    if (!rows.has(gen)) rows.set(gen, []);
    rows.get(gen).push(c.id);
  }
  return [...rows].map(([gen, ids]) => ({ gen, ids }));
}

/** Heading for a generation row relative to the focus person. */
function generationLabel(t, gen, name) {
  if (gen === 0) return t('reportGen0', { n: name });
  const k = Math.abs(gen);
  if (gen > 0) return k <= 3 ? t('reportGenUp' + k) : t('reportGenUpN', { k: k - 2, d: k });
  return k <= 3 ? t('reportGenDown' + k) : t('reportGenDownN', { k: k - 2, d: k });
}

/* Everything rendering needs besides the model. */
function context(model, opts) {
  const { t, lang = 'en', today = new Date(), notes = true, hideLiving = false } = opts;
  const hidden = p => hideLiving && isLiving(p, today);
  const about = uncertain => uncertain ? t('reportAbout') + ' ' : '';
  const date = (value, uncertain) => value ? about(uncertain) + formatDate(value, lang) : '';
  const year = (value, uncertain) => { const y = yearOf(value); return y ? about(uncertain) + y : ''; };
  const place = (p, key) => {
    const pl = p[key + '_place'], country = p[key + '_country'];
    return [pl ? pl + (p[key + '_place_uncertain'] ? ` (${t('uncertain')})` : '') : '', country || ''].filter(Boolean).join(', ');
  };
  const event = (p, key) => [date(p[key + '_date'], p[key + '_date_uncertain']), place(p, key)].filter(Boolean).join(', ');
  const span = p => {
    if (hidden(p)) return '';
    const b = year(p.birth_date, p.birth_date_uncertain), d = year(p.death_date, p.death_date_uncertain);
    if (b && d) return `${b} – ${d}`;
    if (b) return p.deceased ? `${b} – †` : `${t('born')} ${b}`;
    if (d) return `${t('died')} ${d}`;
    return p.deceased ? '†' : '';
  };
  return { t, lang, today, notes, hidden, about, event, span, model };
}

/* label/value rows describing one person; empty values are left out */
function facts(c, p) {
  const { t } = c;
  if (c.hidden(p)) return [[t('reportStatus'), t('reportLiving')]];
  const age = p.death_date && ageOf(p, c.today);
  const cause = [p.death_cause ? t('cause_' + p.death_cause) : '', p.death_cause_detail || ''].filter(Boolean).join(': ');
  return [
    [t('aliases'), p.aliases],
    [t('maidenName'), p.maiden_name],
    [t('sex'), p.sex === 'M' ? t('male') : p.sex === 'F' ? t('female') : ''],
    [t('reportBorn'), c.event(p, 'birth')],
    [t('reportDied'), c.event(p, 'death')],
    [t('ageAtDeath'), age?.years ? c.about(age.approx) + age.years : ''],
    [t('deathCause'), cause],
    [t('reportBuried'), p.burial_place],
    [t('occupation'), p.occupation]
  ].filter(([, v]) => v).map(([k, v]) => [k, esc(v)]);
}

function notesHtml(c, p) {
  if (!c.notes || !p.notes || c.hidden(p)) return '';
  return `<div class="rp-notes">${String(p.notes).split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

/**
 * A report of the people placed by the current view, one section per
 * generation, each person numbered with facts, relatives (cross-referenced by
 * number when they are in the report) and notes.
 * cards: the layout's placed cards ({ id, x, y }).
 * opts: { t, lang, today, title, note, view, notes, hideLiving }.
 */
export function viewReport(model, cards, focusId, opts) {
  const c = context(model, opts);
  const { t, lang, today } = c;
  const rows = generationRows(cards, focusId).filter(r => (r.ids = r.ids.filter(id => model.byId.has(id))).length);
  const num = new Map(rows.flatMap(r => r.ids).map((id, i) => [id, i + 1]));
  const focus = model.byId.get(focusId);
  const ref = id => {
    const q = model.byId.get(id);
    return q ? esc(q.name || '?') + (num.has(id) ? ` <span class="rp-ref">[${num.get(id)}]</span>` : '') : '';
  };
  const refs = (ids, ghosts = []) => [...ids.map(ref), ...ghosts.map(esc)].filter(Boolean).join('; ');
  const entry = id => {
    const p = model.byId.get(id);
    const span = c.span(p);
    const rel = [
      [t('father'), refs(p._father ? [p._father] : [], p._unres?.father ? [p._unres.father] : [])],
      [t('mother'), refs(p._mother ? [p._mother] : [], p._unres?.mother ? [p._unres.mother] : [])],
      [t('spouses'), refs(p._spouses, p._unres?.spouses)],
      [t('children'), refs(birthSortIds(model, p._children), p._unres?.children)]
    ].filter(([, v]) => v);
    const rows = [...facts(c, p), ...rel];
    return `<li class="rp-entry${id === focusId ? ' rp-focus' : ''}" value="${num.get(id)}">` +
      `<h3><span class="rp-num">${num.get(id)}.</span> ${esc(p.name || '?')}` +
      (span ? ` <span class="rp-life">(${esc(span)})</span>` : '') + '</h3>' +
      (rows.length ? `<dl class="rp-facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '') +
      notesHtml(c, p) + '</li>';
  };
  const printed = formatDate(`${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`, lang);
  const head = `<header class="rp-head"><h1>${esc(opts.title || t('title'))}</h1>` +
    `<p class="rp-sub">${esc(`${opts.view}: ${focus?.name || '?'} · ${t('reportPeople', { n: num.size })}`)}</p>` +
    (opts.note ? `<p class="rp-note">${esc(opts.note)}</p>` : '') +
    `<p class="rp-meta">${esc(t('reportPrinted', { d: printed }))} · Genograph</p></header>`;
  const body = rows.map(r => `<section class="rp-gen"><h2>${esc(generationLabel(t, r.gen, focus?.name || '?'))}</h2>` +
    `<ol class="rp-list">${r.ids.map(entry).join('')}</ol></section>`).join('');
  return `<article class="rp" lang="${esc(lang)}">${head}${body}</article>`;
}
