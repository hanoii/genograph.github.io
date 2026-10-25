/* ============================================================
 * Genograph — relationship commands (pure: no DOM)
 *
 * Keeps parent/child and spouse links reciprocal when adding or removing them,
 * and rejects ancestry cycles before mutating the in-memory model.
 * ============================================================ */
'use strict';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function requirePerson(model, id) {
  const person = id && model.byId.get(id);
  if (!person) fail('ENOPERSON', 'The selected person no longer exists.');
  return person;
}

const addUnique = (items, id) => { if (!items.includes(id)) items.push(id); };
const without = (items, id) => items.filter(item => item !== id);

/** True when making parentId a parent of childId would create an ancestry cycle. */
export function wouldCreateParentCycle(model, parentId, childId) {
  if (!parentId || !childId) return false;
  if (parentId === childId) return true;
  const pending = [parentId];
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === childId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const person = model.byId.get(id);
    if (!person) continue;
    if (person._father) pending.push(person._father);
    if (person._mother) pending.push(person._mother);
  }
  return false;
}

/** Validate a parent assignment without changing the model. */
export function assertCanSetParent(model, childId, parentId, slot) {
  if (slot !== '_father' && slot !== '_mother') fail('EBADSLOT', 'Unknown parent role.');
  const child = requirePerson(model, childId);
  requirePerson(model, parentId);
  if (child[slot === '_father' ? '_mother' : '_father'] === parentId) {
    fail('EDUPPARENT', 'The same person cannot fill both parent roles.');
  }
  if (wouldCreateParentCycle(model, parentId, childId)) {
    fail('ECYCLE', 'That relationship would create an ancestry cycle.');
  }
}

/** Set one parent role and repair both the old and new reciprocal child lists. */
export function setParent(model, childId, parentId, slot) {
  assertCanSetParent(model, childId, parentId, slot);
  const child = requirePerson(model, childId);
  const parent = requirePerson(model, parentId);
  const previousId = child[slot];
  if (previousId && previousId !== parentId) {
    const previous = model.byId.get(previousId);
    if (previous) previous._children = without(previous._children, childId);
  }
  child[slot] = parentId;
  addUnique(parent._children, childId);
  return { child, parent, previous: previousId ? model.byId.get(previousId) : null };
}

/** Link two spouses symmetrically. */
export function linkSpouses(model, firstId, secondId) {
  if (firstId === secondId) fail('ESELF', 'A person cannot be linked to themselves.');
  const first = requirePerson(model, firstId);
  const second = requirePerson(model, secondId);
  addUnique(first._spouses, secondId);
  addUnique(second._spouses, firstId);
  return { first, second };
}

/** Remove every parent role parentId holds for childId, from both sides. */
export function unlinkParentChild(model, parentId, childId) {
  const parent = requirePerson(model, parentId);
  const child = requirePerson(model, childId);
  for (const slot of ['_father', '_mother']) if (child[slot] === parentId) child[slot] = null;
  parent._children = without(parent._children, childId);
  return { parent, child };
}

/** Unlink two spouses on both sides. */
export function unlinkSpouses(model, firstId, secondId) {
  const first = requirePerson(model, firstId);
  const second = requirePerson(model, secondId);
  first._spouses = without(first._spouses, secondId);
  second._spouses = without(second._spouses, firstId);
  return { first, second };
}
