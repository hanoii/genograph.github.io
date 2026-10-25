import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, serialize } from '../public/lib/model.js';
import { linkSpouses, setParent, unlinkParentChild, unlinkSpouses, wouldCreateParentCycle } from '../public/lib/relationships.js';

const family = () => buildModel({
  people: [
    { id: 'grandparent', name: 'Grandparent' },
    { id: 'old-parent', name: 'Old parent', children_ids: ['child'] },
    { id: 'new-parent', name: 'New parent' },
    { id: 'child', name: 'Child', father_id: 'old-parent' }
  ]
});

test('setParent repairs reciprocal child lists when a parent changes', () => {
  const model = family();
  setParent(model, 'child', 'new-parent', '_father');
  assert.equal(model.byId.get('child')._father, 'new-parent');
  assert.ok(!model.byId.get('old-parent')._children.includes('child'));
  assert.ok(model.byId.get('new-parent')._children.includes('child'));
});

test('parent commands reject self-links and descendant-as-parent cycles atomically', () => {
  const model = family();
  setParent(model, 'old-parent', 'grandparent', '_father');
  assert.equal(wouldCreateParentCycle(model, 'child', 'grandparent'), true);
  assert.throws(() => setParent(model, 'grandparent', 'child', '_father'), { code: 'ECYCLE' });
  assert.equal(model.byId.get('grandparent')._father, null);
  assert.throws(() => setParent(model, 'child', 'child', '_mother'), { code: 'ECYCLE' });
});

test('a person cannot occupy both parent roles', () => {
  const model = family();
  assert.throws(() => setParent(model, 'child', 'old-parent', '_mother'), { code: 'EDUPPARENT' });
  assert.equal(model.byId.get('child')._mother, null);
});

test('spouse commands are symmetric, deduplicated, and reject self-links', () => {
  const model = family();
  linkSpouses(model, 'old-parent', 'new-parent');
  linkSpouses(model, 'old-parent', 'new-parent');
  assert.deepEqual(model.byId.get('old-parent')._spouses, ['new-parent']);
  assert.deepEqual(model.byId.get('new-parent')._spouses, ['old-parent']);
  assert.throws(() => linkSpouses(model, 'child', 'child'), { code: 'ESELF' });
});

test('unlink commands remove links on both sides and keep both people', () => {
  const model = family();
  linkSpouses(model, 'old-parent', 'new-parent');
  unlinkSpouses(model, 'new-parent', 'old-parent');
  assert.deepEqual(model.byId.get('old-parent')._spouses, []);
  assert.deepEqual(model.byId.get('new-parent')._spouses, []);

  unlinkParentChild(model, 'old-parent', 'child');
  assert.equal(model.byId.get('child')._father, null);
  assert.ok(!model.byId.get('old-parent')._children.includes('child'));
  assert.equal(model.people.length, 4, 'nobody is deleted');
  assert.throws(() => unlinkSpouses(model, 'child', 'missing'), { code: 'ENOPERSON' });
});

test('removed links stay removed after a save and reload', () => {
  const model = family();
  linkSpouses(model, 'old-parent', 'new-parent');
  unlinkSpouses(model, 'old-parent', 'new-parent');
  unlinkParentChild(model, 'old-parent', 'child');
  const reloaded = buildModel(serialize(model));
  assert.deepEqual(reloaded.byId.get('old-parent')._spouses, []);
  assert.deepEqual(reloaded.byId.get('old-parent')._children, []);
  assert.equal(reloaded.byId.get('child')._father, null);
});
