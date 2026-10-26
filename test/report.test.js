/* Tests for the printable view report (public/lib/report.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel } from '../public/lib/model.js';
import { layout } from '../public/lib/layout.js';
import { isLiving, formatDate, generationRows, viewReport } from '../public/lib/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(__dirname, '..', 'examples', 'lusignan.json');
const loadExample = () => buildModel(JSON.parse(readFileSync(EXAMPLE, 'utf8')));

// labels are their keys, with any {vars} appended, so assertions don't depend on wording
const t = (k, vars) => vars ? `${k}(${Object.values(vars).join(',')})` : k;
const TODAY = new Date(2026, 9, 26);
const opts = extra => ({ t, lang: 'en', today: TODAY, title: 'Test tree', view: 'Whole Family', ...extra });
const report = (model, focusId, mode, extra) => viewReport(model, layout(model, focusId, mode).cards, focusId, opts(extra));
// the entry of the person with this name: from their heading to the end of their list item
const entryOf = (html, name) => {
  const at = html.indexOf(`</span> ${name}`);
  assert.ok(at > 0, `${name} has an entry`);
  return html.slice(at, html.indexOf('</li>', at));
};

function family() {
  return buildModel({
    people: [
      { id: 'g', name: 'Gus Grand', sex: 'M', birth_date: '1870', death_date: '1940', deceased: true, children_ids: ['a'] },
      { id: 'a', name: 'Anna Old', sex: 'F', birth_date: '1900.03.04', death_date: '1980.03.05', deceased: true, notes: 'Told <stories>.', father_id: 'g', spouse_ids: ['b'], children_ids: ['c', 'd'] },
      { id: 'b', name: 'Bob Old', sex: 'M', birth_date: '1898', birth_date_uncertain: true, spouse_ids: ['a'], children_ids: ['c', 'd'], deceased: true },
      { id: 'c', name: 'Cara Young', sex: 'F', birth_date: '1990', birth_place: 'Lyon', birth_country: 'France', father_id: 'b', mother_id: 'a', notes: 'Private note' },
      { id: 'd', name: 'Dan Young', sex: 'M', birth_date: '1930', death_date: '2001', father_id: 'b', mother_id: 'a', deceased: true }
    ]
  });
}

test('isLiving: deceased, dated deaths and the implausibly old are not living', () => {
  assert.equal(isLiving({ birth_date: '1990' }, TODAY), true);
  assert.equal(isLiving({}, TODAY), true);
  assert.equal(isLiving({ birth_date: '1990', deceased: true }, TODAY), false);
  assert.equal(isLiving({ death_date: '2001' }, TODAY), false);
  assert.equal(isLiving({ birth_date: '1850' }, TODAY), false);
});

test('formatDate writes day, short month and year at the precision recorded', () => {
  assert.equal(formatDate('1194.07.18', 'en'), '18 Jul 1194');
  assert.equal(formatDate('1194.07', 'en'), 'Jul 1194');
  assert.equal(formatDate('1194', 'en'), '1194');
  assert.equal(formatDate('1194.13', 'en'), '1194.13');
  assert.equal(formatDate('sometime', 'en'), 'sometime');
  assert.equal(formatDate('', 'en'), '');
});

test('generationRows: oldest generation first, left to right, counted from the focus row', () => {
  const rows = generationRows([
    { id: 'kid', x: 0, y: 175 }, { id: 'me', x: 200, y: 0 }, { id: 'sib', x: 0, y: 0 },
    { id: 'mum', x: 200, y: -175 }, { id: 'dad', x: 0, y: -175 }, { id: 'me', x: 400, y: 0 }
  ], 'me');
  assert.deepEqual(rows, [
    { gen: 1, ids: ['dad', 'mum'] },
    { gen: 0, ids: ['sib', 'me'] },
    { gen: -1, ids: ['kid'] }
  ]);
});

test('viewReport: the view\'s people by generation, parents included, focus marked', () => {
  const html = report(family(), 'a', 'full');
  assert.match(html, /Whole Family: Anna Old · reportPeople\(5\)/);
  const gens = ['reportGenUp1', 'reportGen0(Anna Old)', 'reportGenDown1'].map(l => html.indexOf(`<h2>${l}</h2>`));
  assert.ok(gens.every(i => i > 0) && gens[0] < gens[1] && gens[1] < gens[2], 'generations, oldest first');
  assert.ok(html.indexOf('Gus Grand') < gens[1], 'the parent is in the generation above');
  assert.match(html, /class="rp-entry rp-focus" value="\d+"><h3><span class="rp-num">\d+\.<\/span> Anna Old/);
  assert.match(entryOf(html, 'Anna Old'), /4 Mar 1900/);
  assert.match(entryOf(html, 'Anna Old'), /<dt>ageAtDeath<\/dt><dd>80<\/dd>/);
  assert.match(entryOf(html, 'Bob Old'), /reportAbout 1898/);
  assert.match(entryOf(html, 'Cara Young'), /Lyon, France/);
});

test('viewReport: relatives in the report are cross-referenced by number', () => {
  const html = report(family(), 'a', 'full');
  const num = name => new RegExp(`value="(\\d+)"><h3><span class="rp-num">\\d+\\.</span> ${name}`).exec(html)[1];
  assert.match(entryOf(html, 'Cara Young'), new RegExp(`Bob Old <span class="rp-ref">\\[${num('Bob Old')}\\]`));
  assert.match(entryOf(html, 'Anna Old'), new RegExp(`Gus Grand <span class="rp-ref">\\[${num('Gus Grand')}\\]`));
});

test('viewReport: only the people the view placed, and relatives outside it are named without a number', () => {
  const html = report(family(), 'a', 'ancestors');
  assert.match(html, /reportPeople\(2\)/);
  assert.doesNotMatch(html, /<\/span> Cara Young/);
  assert.match(entryOf(html, 'Anna Old'), /Cara Young(?! <span class="rp-ref">)/);
});

test('viewReport: notes are escaped and can be left out', () => {
  const html = report(family(), 'a', 'full');
  assert.match(html, /Told &lt;stories&gt;\./);
  assert.doesNotMatch(html, /<stories>/);
  assert.doesNotMatch(report(family(), 'a', 'full', { notes: false }), /stories|rp-notes/);
});

test('viewReport: hiding the living keeps their names but withholds their details', () => {
  const html = report(family(), 'a', 'full', { hideLiving: true });
  const cara = entryOf(html, 'Cara Young');
  assert.match(cara, /reportLiving/);
  assert.doesNotMatch(cara, /1990|Lyon|Private note/);
  assert.match(entryOf(html, 'Anna Old'), /4 Mar 1900/);
});

test('viewReport: generations far from the focus get numbered labels', () => {
  const model = buildModel({
    people: ['p0', 'p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, name: 'P' + i, father_id: i < 4 ? 'p' + (i + 1) : undefined }))
  });
  const html = report(model, 'p0', 'ancestors');
  for (const label of ['reportGenUpN(2,4)', 'reportGenUp3', 'reportGenUp2', 'reportGenUp1', 'reportGen0(P0)']) assert.match(html, new RegExp(`<h2>${label.replace(/[()]/g, '\\$&')}</h2>`));
});

test('viewReport renders each view of the bundled example', () => {
  const model = loadExample();
  for (const mode of ['full', 'close', 'ancestors']) {
    const cards = layout(model, 'p1', mode).cards;
    const html = viewReport(model, cards, 'p1', opts({ view: mode }));
    assert.equal((html.match(/class="rp-entry/g) || []).length, new Set(cards.map(c => c.id)).size, mode);
    assert.match(html, /Hugh VIII de Lusignan/);
  }
});
