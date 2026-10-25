/* ============================================================
 * Genograph — tree layout (pure: no DOM)
 *
 * Computes card positions and connector line segments for a model rooted on
 * `focusId`, in one of three modes:
 *   full      — focus person's ancestors (+ their siblings) and all descendants
 *   close     — direct ancestor line plus each ancestor's siblings
 *   ancestors — only the direct pedigree line
 *
 * Blocks are packed using per-generation horizontal "contours" so deep
 * descendant subtrees can never collide with neighbouring branches.
 * ============================================================ */
'use strict';

import { birthSortIds } from './model.js';

export const CARD_W = 180, CARD_H = 72, H_GAP = 18, PITCH = 175, MAXDEPTH = 30;
export const MAX_LAYOUT_WORK = 40_000, MAX_LAYOUT_CARDS = 12_000;

/**
 * @returns {{cards: {id,x,y}[], segs: [number,number,number,number][], bbox: {minX,minY,maxX,maxY}}}
 */
export function layout(model, focusId, mode) {
  const by = id => model.byId.get(id);
  const cards = [], segs = [];
  let work = 0;
  const spend = () => {
    if (++work > MAX_LAYOUT_WORK) {
      throw new RangeError('Tree layout exceeds the safe complexity limit.');
    }
  };
  const spine = new Set();
  (function up(id, d) {
    if (!id || d > MAXDEPTH || spine.has(id)) return;
    const p = by(id); if (!p) return;
    spine.add(id);
    up(p._father, d + 1); up(p._mother, d + 1);
  })(focusId, 0);

  const full = mode === 'full', ancOnly = mode === 'ancestors';
  const addCard = (id, x, gen) => {
    if (cards.length >= MAX_LAYOUT_CARDS) {
      throw new RangeError('Tree layout exceeds the safe card limit.');
    }
    cards.push({ id, x, y: -gen * PITCH });
  };
  const seg = (a, b, c, d) => segs.push([a, b, c, d]);
  const GAP = H_GAP, INF = 1e9;

  /* Generation contours: Map<gen, [lo, hi]> of the horizontal extent a block
     occupies on each generation row. */
  const trans = (cont, dg) => { const m = new Map(); for (const [g, iv] of cont) m.set(g + dg, iv); return m; };
  const mergeCont = (target, src, dx, dg) => {
    for (const [g, iv] of src) {
      const G = g + dg, cur = target.get(G);
      if (cur) { cur[0] = Math.min(cur[0], iv[0] + dx); cur[1] = Math.max(cur[1], iv[1] + dx); }
      else target.set(G, [iv[0] + dx, iv[1] + dx]);
    }
  };
  // horizontal slack between left contour A (at aOff) and right contour B (at bOff); null if no shared generations
  const clearance = (A, aOff, B, bOff) => {
    let s = null;
    for (const [g, iv] of B) {
      const a = A.get(g);
      if (a) s = Math.min(s ?? INF, (iv[0] + bOff) - (a[1] + aOff) - GAP);
    }
    return s;
  };

  // marriage connector between two card centers on the same row; returns drop point
  function marriage(cx1, cx2, gen) {
    const top = -gen * PITCH, mid = top + CARD_H / 2, bot = top + CARD_H;
    const l = Math.min(cx1, cx2), r = Math.max(cx1, cx2);
    if (r - l <= CARD_W + H_GAP + 12) {
      seg(l + CARD_W / 2, mid, r - CARD_W / 2, mid);
      return { x: (l + r) / 2, y: mid };
    }
    const rail = bot + 12;
    seg(l, bot, l, rail); seg(r, bot, r, rail); seg(l, rail, r, rail);
    return { x: (l + r) / 2, y: rail };
  }
  function dropToChildren(drop, childCenters, childGen) {
    if (!childCenters.length) return;
    const cTop = -childGen * PITCH, bus = cTop - 26;
    seg(drop.x, drop.y, drop.x, bus);
    const lo = Math.min(drop.x, ...childCenters), hi = Math.max(drop.x, ...childCenters);
    if (hi > lo) seg(lo, bus, hi, bus);
    for (const c of childCenters) seg(c, bus, c, cTop);
  }

  // a bare single-card block
  const cardBlock = pid => ({
    cont: new Map([[0, [0, CARD_W]]]),
    cx: CARD_W / 2,
    place(x, gen) { addCard(pid, x, gen); return x + CARD_W / 2; }
  });

  // descendant block: person (+spouses, +children recursively in full mode)
  function descNode(pid, depth, trail = new Set()) {
    spend();
    const p = by(pid);
    const withFam = full && !!p && depth < MAXDEPTH && !trail.has(pid);
    const nextTrail = new Set(trail);
    nextTrail.add(pid);
    const spouses = withFam ? [...new Set(p._spouses.filter(s => !spine.has(s) && by(s)))] : [];
    const kids = withFam
      ? birthSortIds(model, [...new Set(p._children.filter(c => by(c) && !nextTrail.has(c)))])
      : [];
    if (!spouses.length && !kids.length) return cardBlock(pid);
    const kidB = kids.map(k => descNode(k, depth + 1, nextTrail));
    const cont = new Map();
    const kidDx = [];
    for (const b of kidB) {
      const bc = trans(b.cont, -1);
      const c = kidDx.length ? clearance(cont, 0, bc, 0) : null;
      const dx = c == null ? 0 : -c;
      kidDx.push(dx);
      mergeCont(cont, bc, dx, 0);
    }
    const kidCenters = kidB.map((b, i) => kidDx[i] + b.cx);
    const coupleW = CARD_W + spouses.length * (CARD_W + GAP);
    const coupleX = kidCenters.length
      ? (Math.min(...kidCenters) + Math.max(...kidCenters)) / 2 - coupleW / 2 : 0;
    mergeCont(cont, new Map([[0, [coupleX, coupleX + coupleW]]]), 0, 0);
    return {
      cont,
      cx: coupleX + CARD_W / 2,
      place(x, gen) {
        addCard(pid, x + coupleX, gen);
        const pc = x + coupleX + CARD_W / 2;
        let sx = x + coupleX + CARD_W + GAP;
        const drops = new Map();
        for (const s of spouses) {
          addCard(s, sx, gen);
          const sc = sx + CARD_W / 2;
          drops.set(s, marriage(pc, sc, gen));
          sx += CARD_W + GAP;
        }
        if (kidB.length) {
          const cc = kidB.map((b, i) => b.place(x + kidDx[i], gen - 1));
          const groups = new Map();
          kids.forEach((kidId, index) => {
            const child = by(kidId);
            let partner = null;
            if (child?._father === pid) partner = child._mother;
            else if (child?._mother === pid) partner = child._father;
            if (!drops.has(partner)) partner = null;
            if (!groups.has(partner)) groups.set(partner, []);
            groups.get(partner).push(cc[index]);
          });
          const ownDrop = { x: pc, y: -gen * PITCH + CARD_H };
          for (const [partner, centers] of groups) {
            dropToChildren((partner && drops.get(partner)) || ownDrop, centers, gen - 1);
          }
        }
        return pc;
      }
    };
  }

  // ancestor block for a person on the direct line; `side` is 'father' or 'mother'
  // when pid is a parent of the person below, so pid can sit next to their spouse
  function ancNode(pid, depth, trail = new Set(), side = null) {
    if (!pid || depth > MAXDEPTH || trail.has(pid)) return null;
    spend();
    const p = by(pid);
    if (!p) return null;
    const nextTrail = new Set(trail);
    nextTrail.add(pid);
    const faId = (p && p._father && by(p._father)) ? p._father : null;
    const moId = (p && p._mother && by(p._mother)) ? p._mother : null;
    const faB = (faId && depth < MAXDEPTH) ? ancNode(faId, depth + 1, nextTrail, 'father') : null;
    const moB = (moId && moId !== faId && depth < MAXDEPTH)
      ? ancNode(moId, depth + 1, nextTrail, 'mother')
      : null;

    let rowIds = [pid];
    if (!ancOnly && (faId || moId)) {
      const seen = new Set(); rowIds = [];
      const lists = [faId ? by(faId)._children : [], moId ? by(moId)._children : []];
      for (const l of lists) for (const c of l) {
        if (!seen.has(c) && by(c) && (c === pid || !spine.has(c))) { seen.add(c); rowIds.push(c); }
      }
      if (!seen.has(pid)) rowIds.push(pid);
      rowIds = birthSortIds(model, rowIds);
      // siblings stay in birth order, but a father sits at the right end of his row
      // and a mother at the left end, so the couple meets in the middle
      if (side) {
        rowIds = rowIds.filter(id => id !== pid);
        if (side === 'father') rowIds.push(pid); else rowIds.unshift(pid);
      }
    }
    const rowB = rowIds.map(id => id === pid
      ? (pid === focusId ? descNode(pid, 0) : cardBlock(pid))
      : descNode(id, 1));

    // pack the sibling row left-to-right
    const rowCont = new Map();
    const rowDx = [];
    for (const b of rowB) {
      const c = rowDx.length ? clearance(rowCont, 0, b.cont, 0) : null;
      const dx = c == null ? 0 : -c;
      rowDx.push(dx);
      mergeCont(rowCont, b.cont, dx, 0);
    }
    const rowCenters = rowB.map((b, i) => rowDx[i] + b.cx);
    const rowMidBase = (Math.min(...rowCenters) + Math.max(...rowCenters)) / 2;

    const faCont = faB ? trans(faB.cont, 1) : null;
    const moCont = moB ? trans(moB.cont, 1) : null;

    // row starts tight against the father-side block (if their contours share generations)
    let r = 0;
    if (faCont) { const c = clearance(faCont, 0, rowCont, 0); if (c != null) r = -c; }
    // mother block packs tight against father block and the row
    let dxMo = 0;
    if (moCont) {
      const cs = [faCont ? clearance(faCont, 0, moCont, 0) : null, clearance(rowCont, r, moCont, 0)]
        .filter(v => v != null);
      if (cs.length) dxMo = -Math.min(...cs);
    }
    // cosmetic pass: center the row under the marriage midpoint within the free slack,
    // then nudge the parents toward the row if the row could not reach the midpoint
    const faCx = faB ? faB.cx : null;
    const moCx = moB ? dxMo + moB.cx : null;
    const mid = (faCx != null && moCx != null) ? (faCx + moCx) / 2 : (faCx ?? moCx);
    let q = 0;
    if (mid != null) {
      const cL = faCont ? clearance(faCont, 0, rowCont, r) : null;
      const rMin = cL == null ? -INF : r - cL;
      const cR = moCont ? clearance(rowCont, r, moCont, dxMo) : null;
      const rMax = cR == null ? INF : r + cR;
      r = Math.max(rMin, Math.min(rMax, mid - rowMidBase));
      const diff = (rowMidBase + r) - mid;
      if (diff > 0.5) {
        const c3 = faCont ? clearance(faCont, 0, rowCont, r) : null;
        q = Math.min(diff, c3 == null ? INF : c3);
      } else if (diff < -0.5) {
        const c4 = moCont ? clearance(rowCont, r, moCont, dxMo) : null;
        q = -Math.min(-diff, c4 == null ? INF : c4);
      }
    }
    const cont = new Map();
    if (faCont) mergeCont(cont, faCont, q, 0);
    mergeCont(cont, rowCont, r, 0);
    if (moCont) mergeCont(cont, moCont, dxMo + q, 0);
    const selfIdx = rowIds.indexOf(pid);
    return {
      cont,
      cx: r + rowDx[selfIdx] + rowB[selfIdx].cx,
      place(x, gen) {
        let fC = null, mC = null;
        if (faB) fC = faB.place(x + q, gen + 1);
        if (moB) mC = moB.place(x + dxMo + q, gen + 1);
        const centers = []; let selfC = null;
        rowB.forEach((b, i) => {
          const c = b.place(x + r + rowDx[i], gen);
          centers.push(c);
          if (rowIds[i] === pid) selfC = c;
        });
        if (fC != null || mC != null) {
          const d = (fC != null && mC != null) ? marriage(fC, mC, gen + 1)
            : { x: fC ?? mC, y: -(gen + 1) * PITCH + CARD_H };
          dropToChildren(d, centers, gen);
        }
        return selfC;
      }
    };
  }

  if (focusId && by(focusId)) {
    const root = ancNode(focusId, 0);
    if (root) root.place(0, 0);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x + CARD_W);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y + CARD_H);
  }
  if (!cards.length) { minX = minY = 0; maxX = maxY = 1; }
  return { cards, segs, bbox: { minX, minY, maxX, maxY } };
}
