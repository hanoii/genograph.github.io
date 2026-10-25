/* Tests for the pure layout algorithm (public/lib/layout.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel, rootIdOf } from '../public/lib/model.js';
import { layout, CARD_W, CARD_H, PITCH, H_GAP } from '../public/lib/layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const example = () => buildModel(JSON.parse(readFileSync(path.join(__dirname, '..', 'examples', 'lusignan.json'), 'utf8')));

function overlaps(a, b) {
  return a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + CARD_H && b.y < a.y + CARD_H;
}

for (const mode of ['full', 'close', 'ancestors']) {
  test(`layout (${mode}) — no two cards overlap`, () => {
    const m = example();
    const { cards } = layout(m, rootIdOf(m), mode);
    assert.ok(cards.length > 0, 'produces cards');
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        assert.ok(!overlaps(cards[i], cards[j]),
          `cards ${cards[i].id} and ${cards[j].id} overlap in ${mode} mode`);
      }
    }
  });

  test(`layout (${mode}) — every card maps to a real person and bbox is finite`, () => {
    const m = example();
    const { cards, bbox } = layout(m, rootIdOf(m), mode);
    for (const c of cards) assert.ok(m.byId.has(c.id), `${c.id} exists`);
    assert.equal(new Set(cards.map(c => c.id)).size, cards.length, 'no duplicate cards');
    for (const v of [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]) assert.ok(Number.isFinite(v));
    assert.ok(bbox.maxX > bbox.minX && bbox.maxY > bbox.minY);
  });
}

test('layout — ancestors mode shows only the direct line (focus + parents)', () => {
  const m = example();
  const { cards } = layout(m, 'p1', 'ancestors');
  const ids = cards.map(c => c.id).sort();
  assert.deepEqual(ids, ['p1', 'p2', 'p3'], 'Guy + father + mother only');
});

test('layout — deterministic for the same inputs', () => {
  const m = example();
  const a = layout(m, rootIdOf(m), 'full');
  const b = layout(m, rootIdOf(m), 'full');
  assert.deepEqual(a.cards, b.cards);
  assert.deepEqual(a.segs, b.segs);
});

test('layout — empty / unknown focus yields an empty, finite result', () => {
  const m = buildModel({ people: [] });
  const { cards, bbox } = layout(m, null, 'full');
  assert.equal(cards.length, 0);
  for (const v of [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]) assert.ok(Number.isFinite(v));
});

test('layout — ancestry cycles terminate without duplicating cards', () => {
  const model = buildModel({
    people: [
      { id: 'a', name: 'A', father_id: 'b', mother_id: 'b' },
      { id: 'b', name: 'B', father_id: 'a', mother_id: 'a' }
    ]
  });
  const { cards, bbox } = layout(model, 'a', 'ancestors');
  assert.deepEqual(cards.map(card => card.id).sort(), ['a', 'b']);
  for (const value of Object.values(bbox)) assert.ok(Number.isFinite(value));
});

test('layout — converging adversarial pedigrees stop at a global work budget', () => {
  const people = [{ id: 'root', name: 'Root', father_id: 'a0', mother_id: 'b0' }];
  for (let i = 0; i < 16; i++) {
    const nextA = i === 15 ? null : `a${i + 1}`;
    const nextB = i === 15 ? null : `b${i + 1}`;
    people.push({ id: `a${i}`, name: `A${i}`, ...(nextA && { father_id: nextA, mother_id: nextB }) });
    people.push({ id: `b${i}`, name: `B${i}`, ...(nextA && { father_id: nextA, mother_id: nextB }) });
  }
  const model = buildModel({ people });
  assert.throws(() => layout(model, 'root', 'ancestors'), /safe complexity limit/);
});

test('layout — children from different spouses use distinct union drops', () => {
  const model = buildModel({
    people: [
      { id: 'p', name: 'Parent', spouse_ids: ['s1', 's2'], children_ids: ['c1', 'c2'] },
      { id: 's1', name: 'Spouse 1', spouse_ids: ['p'], children_ids: ['c1'] },
      { id: 's2', name: 'Spouse 2', spouse_ids: ['p'], children_ids: ['c2'] },
      { id: 'c1', name: 'Child 1', father_id: 'p', mother_id: 's1' },
      { id: 'c2', name: 'Child 2', father_id: 'p', mother_id: 's2' }
    ]
  });
  const { cards, segs } = layout(model, 'p', 'full');
  assert.equal(new Set(cards.map(card => card.id)).size, 5);
  const center = id => {
    const card = cards.find(candidate => candidate.id === id);
    return card.x + CARD_W / 2;
  };
  const expectedUnionDrops = [(center('p') + center('s1')) / 2, (center('p') + center('s2')) / 2];
  for (const drop of expectedUnionDrops) {
    assert.ok(segs.some(([x1, , x2, y2]) => x1 === drop && x2 === drop && y2 === PITCH - 26),
      `union at ${drop} has its own child drop`);
  }
  const childTops = new Map(cards.filter(card => card.id.startsWith('c')).map(card => [card.id, card.x + CARD_W / 2]));
  for (const center of childTops.values()) {
    assert.ok(segs.some(([x1, , x2, y2]) => x1 === center && x2 === center && y2 === PITCH));
  }
});

test('layout — direct-line parents sit at the inner edge of their sibling rows', () => {
  const model = buildModel({
    people: [
      { id: 'kid', name: 'Kid', father_id: 'dad', mother_id: 'mom' },
      { id: 'dad', name: 'Dad', sex: 'M', birth_date: '1939', father_id: 'gf1', spouse_ids: ['mom'] },
      { id: 'uncle', name: 'Uncle', birth_date: '1945', father_id: 'gf1' },
      { id: 'mom', name: 'Mom', sex: 'F', birth_date: '1940', father_id: 'gf2' },
      { id: 'aunt', name: 'Aunt', birth_date: '1923', father_id: 'gf2' },
      { id: 'aunt2', name: 'Aunt 2', birth_date: '1927', father_id: 'gf2' },
      { id: 'gf1', name: 'Grandfather 1', sex: 'M' },
      { id: 'gf2', name: 'Grandfather 2', sex: 'M' }
    ]
  });
  for (const mode of ['full', 'close']) {
    const { cards } = layout(model, 'kid', mode);
    const x = id => cards.find(card => card.id === id).x;
    assert.ok(x('uncle') < x('dad'), `${mode}: younger brother moves left of the father`);
    assert.ok(x('mom') < x('aunt') && x('aunt') < x('aunt2'), `${mode}: mother first, older sisters after in birth order`);
    assert.equal(x('mom') - x('dad'), CARD_W + H_GAP, `${mode}: the parents are adjacent`);
  }
});
