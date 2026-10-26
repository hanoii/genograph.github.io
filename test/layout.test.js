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
  // the far spouse's rail midpoint sits under s1, so that union drops from the rail above its child
  const expectedUnionDrops = [(center('p') + center('s1')) / 2, center('c2')];
  for (const drop of expectedUnionDrops) {
    assert.ok(segs.some(([x1, , x2, y2]) => x1 === drop && x2 === drop && y2 === PITCH - 26),
      `union at ${drop} has its own child drop`);
  }
  const childTops = new Map(cards.filter(card => card.id.startsWith('c')).map(card => [card.id, card.x + CARD_W / 2]));
  for (const center of childTops.values()) {
    assert.ok(segs.some(([x1, , x2, y2]) => x1 === center && x2 === center && y2 === PITCH));
  }
});

test('layout — explicit siblings of a parentless ancestor share a sibling bar', () => {
  const model = buildModel({
    people: [
      { id: 'kid', name: 'Kid', father_id: 'dad', mother_id: 'mom' },
      { id: 'dad', name: 'Dad', sex: 'M', spouse_ids: ['mom'] },
      { id: 'mom', name: 'Mom', sex: 'F', sibling_ids: ['uncle'] },
      { id: 'uncle', name: 'Uncle', sex: 'M' }
    ]
  });
  for (const mode of ['full', 'close']) {
    const { cards, segs } = layout(model, 'kid', mode);
    const card = id => cards.find(candidate => candidate.id === id);
    assert.ok(card('uncle'), `${mode}: uncle is placed`);
    assert.equal(card('uncle').y, card('mom').y, `${mode}: uncle shares the mother's row`);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(cards[i], cards[j]), `${mode}: no overlap`);
    }
    const bar = -PITCH - 12;
    const [lo, hi] = [card('mom'), card('uncle')].map(c => c.x + CARD_W / 2).sort((x, y) => x - y);
    assert.ok(segs.some(([x1, y1, x2, y2]) => y1 === bar && y2 === bar && x1 === lo && x2 === hi), `${mode}: sibling bar`);
  }
  assert.ok(!layout(model, 'kid', 'ancestors').cards.some(card => card.id === 'uncle'), 'ancestors mode hides siblings');
});

test('layout — an explicit sibling does not hang from the other sibling\'s parents', () => {
  const model = buildModel({
    people: [
      { id: 'me', name: 'Me', father_id: 'dad', sibling_ids: ['half'] },
      { id: 'dad', name: 'Dad', sex: 'M' },
      { id: 'half', name: 'Half', father_id: 'other' },
      { id: 'other', name: 'Other', sex: 'M' }
    ]
  });
  const { cards, segs } = layout(model, 'me', 'full');
  const half = cards.find(card => card.id === 'half');
  const hc = half.x + CARD_W / 2;
  assert.ok(!segs.some(([x1, y1, x2, y2]) => x1 === hc && x2 === hc && y1 === -26 && y2 === 0), 'no parent drop to the explicit sibling');
  assert.ok(segs.some(([x1, y1, x2, y2]) => x1 === hc && x2 === hc && y1 === -12 && y2 === 0), 'sibling bar drop instead');
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

test('layout — a person reachable twice is drawn only once', () => {
  // a mistaken spouse link between two sisters makes each reachable as a
  // sibling and as the other's spouse; a married cousin is reachable twice too
  const model = buildModel({
    people: [
      { id: 'kid', name: 'Kid', mother_id: 'mom' },
      { id: 'mom', name: 'Mom', sex: 'F', father_id: 'gf', spouse_ids: ['aunt'] },
      { id: 'aunt', name: 'Aunt', sex: 'F', father_id: 'gf', spouse_ids: ['mom'] },
      { id: 'uncle', name: 'Uncle', sex: 'M', father_id: 'gf', children_ids: ['cousin'] },
      { id: 'cousin', name: 'Cousin', father_id: 'uncle', spouse_ids: ['kid'] },
      { id: 'gf', name: 'Grandfather', sex: 'M' }
    ]
  });
  for (const mode of ['full', 'close']) {
    const ids = layout(model, 'kid', mode).cards.map(card => card.id);
    assert.equal(new Set(ids).size, ids.length, `${mode}: no duplicate cards (${ids.join(', ')})`);
  }
});

test('layout — close mode shows the focus person\'s spouse and children, not grandchildren', () => {
  const model = buildModel({
    people: [
      { id: 'me', name: 'Me', sex: 'M', father_id: 'dad', spouse_ids: ['wife'] },
      { id: 'wife', name: 'Wife', sex: 'F' },
      { id: 'kid', name: 'Kid', father_id: 'me', mother_id: 'wife', spouse_ids: ['kid-spouse'] },
      { id: 'kid-spouse', name: 'Kid spouse' },
      { id: 'grandkid', name: 'Grandkid', father_id: 'kid' },
      { id: 'dad', name: 'Dad', sex: 'M' },
      { id: 'brother', name: 'Brother', father_id: 'dad', spouse_ids: ['sister-in-law'] },
      { id: 'sister-in-law', name: 'Sister-in-law' },
      { id: 'nephew', name: 'Nephew', father_id: 'brother' }
    ]
  });
  const ids = layout(model, 'me', 'close').cards.map(card => card.id).sort();
  assert.deepEqual(ids, ['brother', 'dad', 'kid', 'me', 'wife']);
  assert.ok(layout(model, 'me', 'full').cards.some(card => card.id === 'grandkid'), 'full mode still has every descendant');
});

test('layout: the focus person sits straight under their parents, their spouse on the side with room', () => {
  // the mother's sister has children on the focus person's row, right where a spouse
  // placed on the right would go
  const people = [
    { id: 'gf', name: 'Grandfather', sex: 'M', spouse_ids: ['gm'], children_ids: ['mo', 'aunt'] },
    { id: 'gm', name: 'Grandmother', sex: 'F', spouse_ids: ['gf'], children_ids: ['mo', 'aunt'] },
    { id: 'fa', name: 'Father', sex: 'M', spouse_ids: ['mo'], children_ids: ['me'] },
    { id: 'mo', name: 'Mother', sex: 'F', birth_date: '1940', father_id: 'gf', mother_id: 'gm', spouse_ids: ['fa'], children_ids: ['me'] },
    { id: 'aunt', name: 'Aunt', sex: 'F', birth_date: '1945', father_id: 'gf', mother_id: 'gm', children_ids: ['c1', 'c2'] },
    { id: 'c1', name: 'Cousin One', mother_id: 'aunt' },
    { id: 'c2', name: 'Cousin Two', mother_id: 'aunt' },
    { id: 'me', name: 'Me', sex: 'M', father_id: 'fa', mother_id: 'mo', spouse_ids: ['sp'], children_ids: ['kid'] },
    { id: 'sp', name: 'Spouse', sex: 'F', spouse_ids: ['me'], children_ids: ['kid'] },
    { id: 'kid', name: 'Kid', father_id: 'me', mother_id: 'sp' }
  ];
  const center = (cards, id) => cards.find(c => c.id === id).x + CARD_W / 2;
  const { cards } = layout(buildModel({ people: structuredClone(people) }), 'me', 'full');
  assert.equal(center(cards, 'me'), (center(cards, 'fa') + center(cards, 'mo')) / 2, 'straight under the parents');
  assert.ok(center(cards, 'sp') < center(cards, 'me'), 'the spouse moved to the left');
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) assert.ok(!overlaps(cards[i], cards[j]), `${cards[i].id} / ${cards[j].id}`);
  }
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length, 'everyone drawn once');
  assert.ok(cards.some(c => c.id === 'kid'), 'the household keeps its children');

  // with room on the right, the spouse stays on the right as before
  const alone = layout(buildModel({ people: structuredClone(people).filter(p => !['aunt', 'c1', 'c2'].includes(p.id)) }), 'me', 'full').cards;
  assert.ok(center(alone, 'sp') > center(alone, 'me'));
  assert.equal(center(alone, 'me'), (center(alone, 'fa') + center(alone, 'mo')) / 2);
});

test('layout: lines leave from the real bottom of cards taller than CARD_H', () => {
  // the second spouse is not next to the person, so their marriage runs as a rail under the cards
  const people = [
    { id: 'me', name: 'Me', sex: 'M', spouse_ids: ['first', 'second'], children_ids: ['kid', 'solo'] },
    { id: 'first', name: 'First', sex: 'F', spouse_ids: ['me'] },
    { id: 'second', name: 'Second', sex: 'F', spouse_ids: ['me'], children_ids: ['kid'] },
    { id: 'kid', name: 'Kid', father_id: 'me', mother_id: 'second' },
    { id: 'solo', name: 'Solo', father_id: 'me' }
  ];
  const model = () => buildModel({ people: structuredClone(people) });
  const center = (cards, id) => cards.find(c => c.id === id).x + CARD_W / 2;
  const railY = segs => segs.find(([x1, y1, x2, y2]) => y1 === y2 && y1 > CARD_H / 2 && y1 < PITCH - 26 && x2 - x1 > CARD_W)?.[1];

  const plain = layout(model(), 'me', 'full');
  assert.equal(railY(plain.segs), CARD_H + 12, 'the rail sits just under standard cards');

  const tall = layout(model(), 'me', 'full', new Map([['second', 100], ['me', 90]]));
  assert.deepEqual(tall.cards, plain.cards, 'card positions do not change');
  assert.equal(railY(tall.segs), 100 + 12, 'the rail clears the taller card');
  const me = center(tall.cards, 'me'), second = center(tall.cards, 'second');
  assert.ok(tall.segs.some(([x1, y1, x2]) => x1 === me && x2 === me && y1 === 90), 'my stub starts at my bottom');
  assert.ok(tall.segs.some(([x1, y1, x2]) => x1 === second && x2 === second && y1 === 100), 'the spouse stub starts at hers');
  assert.equal(tall.bbox.maxY, plain.bbox.maxY, 'the lowest row is unchanged');
  assert.ok(tall.segs.some(([x1, y1, x2, y2]) => x1 === me && x2 === me && y1 === 90 && y2 > 90 && y2 < PITCH),
    'the drop to a child with no co-parent leaves from my real bottom');
});

test('layout: rails under the same row share one depth, below the row\'s tallest card', () => {
  // two spouses who are not next to the person: two rails on one row
  const people = [
    { id: 'me', name: 'Me', sex: 'M', spouse_ids: ['first', 'second', 'third'] },
    { id: 'first', name: 'First', sex: 'F', spouse_ids: ['me'] },
    { id: 'second', name: 'Second', sex: 'F', spouse_ids: ['me'] },
    { id: 'third', name: 'Third', sex: 'F', spouse_ids: ['me'] }
  ];
  const rails = out => out.segs.filter(([x1, y1, x2, y2]) => y1 === y2 && y1 > CARD_H / 2 && x2 - x1 > CARD_W).map(sg => sg[1]);
  const plain = layout(buildModel({ people: structuredClone(people) }), 'me', 'full');
  assert.deepEqual(rails(plain), [CARD_H + 12, CARD_H + 12]);
  const tall = layout(buildModel({ people: structuredClone(people) }), 'me', 'full', new Map([['third', 110]]));
  assert.deepEqual(rails(tall), [110 + 12, 110 + 12], 'the rail to the shorter card drops to the shared depth');
});

// dad's cousins fill the row between dad and mom, so the rail joining them runs over the
// cousins' family: its midpoint sits over their children and their line crosses it
const cousinsBetween = () => buildModel({ people: [
  { id: 'me', name: 'Me', sex: 'F', father_id: 'dad', mother_id: 'mom', birth: '2010' },
  { id: 'bro', name: 'Bro', sex: 'M', father_id: 'dad', mother_id: 'mom', birth: '2008' },
  { id: 'dad', name: 'Dad', sex: 'M', mother_id: 'gm', spouse_ids: ['mom'], birth: '1980' },
  { id: 'mom', name: 'Mom', sex: 'F', spouse_ids: ['dad'] },
  { id: 'gm', name: 'Grandma', sex: 'F', mother_id: 'ggm', birth: '1950' },
  { id: 'aunt', name: 'Great-aunt', sex: 'F', mother_id: 'ggm', birth: '1955' },
  { id: 'ggm', name: 'Great-grandma', sex: 'F' },
  { id: 'cousin', name: 'Cousin', sex: 'F', mother_id: 'aunt', spouse_ids: ['cs'], birth: '1982' },
  { id: 'cs', name: 'Cousin spouse', sex: 'M', spouse_ids: ['cousin'] },
  { id: 'k1', name: 'K1', sex: 'M', mother_id: 'cousin', father_id: 'cs', birth: '2005' },
  { id: 'k2', name: 'K2', sex: 'M', mother_id: 'cousin', father_id: 'cs', birth: '2006' }
]});

test('layout: children hang from the part of a rail above them, not over their cousins', () => {
  const { cards, segs } = layout(cousinsBetween(), 'me', 'full');
  const cx = id => cards.find(c => c.id === id).x + CARD_W / 2;
  const bus = -26;
  const buses = segs.filter(([, y1, , y2]) => y1 === bus && y2 === bus);
  const own = buses.find(([x1, , x2]) => x1 <= cx('me') && cx('me') <= x2);
  assert.ok(own[0] > Math.max(cx('k1'), cx('k2')), 'the siblings\' bus stays clear of the cousins');
  const drops = segs.filter(([x1, y1, x2, y2]) => x1 === x2 && y2 === bus && y1 < bus);
  assert.equal(new Set(drops.map(sg => sg[0])).size, drops.length, 'each family drops at its own x');
});

test('layout: a line crossing another without joining it is broken around the crossing', () => {
  const { cards, segs } = layout(cousinsBetween(), 'me', 'full');
  const cx = id => cards.find(c => c.id === id).x + CARD_W / 2;
  const flat = segs.filter(([x1, y1, x2, y2]) => y1 === y2 && x1 !== x2);
  const upright = segs.filter(([x1, y1, x2, y2]) => x1 === x2 && y1 !== y2);
  const through = ([x, y1, , y2], [a, y, b]) =>
    Math.min(a, b) < x && x < Math.max(a, b) && Math.min(y1, y2) < y && y < Math.max(y1, y2);
  assert.ok(!upright.some(v => flat.some(h => through(v, h))), 'no line runs through another');
  // the cousins' drop to their children has a gap where it passes the rail joining dad and mom
  const rail = flat.find(([a, , b]) => Math.min(a, b) === cx('dad') && Math.max(a, b) === cx('mom'))[1];
  const drop = upright.filter(([x]) => x === (cx('k1') + cx('k2')) / 2);
  assert.ok(drop.some(([, y1, , y2]) => Math.max(y1, y2) < rail), 'the drop reaches toward the rail from above');
  assert.ok(drop.some(([, y1, , y2]) => Math.min(y1, y2) > rail), 'and continues below it');
});
