'use strict';
// Declare: online multiplayer card game server. No dependencies, needs Node 18 or newer.
// Rooms live in memory. Real players only: nobody is added to fill empty seats.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, ROUNDS = 5, MAXP = 10;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rooms = new Map();

// ---------- cards ----------
function vOf(r) { return r === 'A' ? 11 : (r === 'J' || r === 'Q' || r === 'K') ? 10 : +r; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// 2-4 players: one 52-card deck + 2 jokers. 5 players: two decks (104) + 2 jokers. 6 players: two decks + 3 jokers. 7-10 players: two decks + 4 jokers.
function deckSpec(n) { return { copies: n > 4 ? 2 : 1, jokers: n <= 5 ? 2 : n === 6 ? 3 : 4 }; }
function mk(n) {
  const sp = deckSpec(n), d = [];
  for (let c = 0; c < sp.copies; c++) SUITS.forEach(s => RANKS.forEach(r => d.push({ s, r, v: vOf(r) })));
  for (let i = 0; i < sp.jokers; i++) d.push({ s: '★', r: 'Jk', v: 11, j: true });
  return shuffle(d);
}
// best single-suit total (jokers count in any suit), capped at 54
function best(h) {
  const jk = h.filter(c => c.j).length; let b = { s: '♠', t: -1 };
  SUITS.forEach(s => { const t = h.reduce((a, c) => a + (c.s === s ? c.v : 0), 0) + jk * 11; if (t > b.t) b = { s, t }; });
  b.t = Math.min(54, b.t); return b;
}
// best 5 cards to keep out of a pool, and the rest to throw
function pickBest(pool) {
  let out = null;
  SUITS.forEach(s => {
    const keep = pool.filter(x => x.j || x.s === s).sort((a, b) => b.v - a.v).slice(0, 5);
    const rest = pool.filter(x => !keep.includes(x)).sort((a, b) => b.v - a.v);
    while (keep.length < 5 && rest.length) keep.push(rest.shift());
    const t = best(keep).t; if (!out || t > out.t) out = { keep, t };
  });
  out.toss = pool.filter(x => !out.keep.includes(x)); return out;
}

// ---------- rooms ----------
function newRoom() {
  let code;
  do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[crypto.randomInt(23)]).join(''); } while (rooms.has(code));
  const room = { code, players: [], phase: 'lobby', round: 0, deck: [], table: [], turn: 0, step: 'act', pend: 1, msg: [],
    declarer: -1, mult: 1, parts: [], call: null, res: null, upd: Date.now(), tt: null };
  rooms.set(code, room); return room;
}
function cleanName(n) { return String(n || '').replace(/[<>&"'`]/g, '').trim().slice(0, 14) || 'Player'; }
function addPlayer(room, name) {
  name = cleanName(name);
  let n = name, k = 2; while (room.players.some(p => p.name === n)) n = name + ' ' + k++;
  const p = { id: crypto.randomBytes(12).toString('hex'), name: n, hand: [], score: 0, res: null };
  room.players.push(p); return p;
}
function newRound(room) {
  room.round++;
  const n = room.players.length, st = (room.round - 1) % n;
  let dk, hs, ok, tries = 0;
  // middle-difficulty deal: no hand starts too strong or too weak
  do {
    dk = mk(n); hs = room.players.map(() => []);
    for (let i = 0; i < 5; i++) for (let p = 0; p < n; p++) hs[p].push(dk.pop());
    hs[st].push(dk.pop());
    ok = hs.every(h => { const t = pickBest(h).t; return t >= 12 && t <= 30 && h.filter(c => c.j).length <= 1; });
  } while (!ok && ++tries < 300);
  room.deck = dk; room.players.forEach((p, i) => { p.hand = hs[i]; });
  room.table = []; room.turn = st; room.step = 'throw'; room.pend = 1;
  room.phase = 'turn'; room.declarer = -1; room.mult = 1; room.parts = []; room.call = null; room.res = null;
  room.msg = [{ k: 'start', r: room.round, n: room.players[st].name }];
}
function endTurn(room) {
  if (!room.deck.length) return resolve(room, true); // deck ran out: round ends
  room.turn = (room.turn + 1) % room.players.length; room.step = 'act'; room.pend = 1;
  room.msg.push({ k: 'toPlay', n: room.players[room.turn].name });
}
function resolve(room, deckEnd) {
  const parts = deckEnd ? room.players.map((p, i) => i) : room.parts, mult = deckEnd ? 1 : room.mult;
  const tots = parts.map(i => best(room.players[i].hand)); let w = 0;
  tots.forEach((x, i) => { if (x.t > tots[w].t) w = i; }); // ties go to whoever spoke first
  const wi = parts[w], t = tots[w].t, pts = t >= 40 ? t * mult : 0;
  room.players[wi].score += pts;
  room.res = { w: wi, t, pts, mult, de: !!deckEnd, parts: parts.slice() };
  room.phase = 'reveal'; room.call = null;
}

// returns an error string, or undefined when the action worked
function act(room, p, a) {
  const pi = room.players.indexOf(p), mine = room.phase === 'turn' && room.turn === pi;
  switch (a.type) {
    case 'start':
      if (room.phase !== 'lobby' || pi !== 0) return 'host_only';
      if (room.players.length < 2) return 'need2';
      room.players.forEach(x => { x.score = 0; }); room.round = 0; newRound(room); return;
    case 'draw': {
      if (!mine || room.step !== 'act' || !room.deck.length) return 'no_draw';
      const wipe = room.table.length >= 5; if (wipe) room.table = [];
      p.hand.push(room.deck.pop()); room.step = 'throw'; room.pend = 1;
      room.msg = [{ k: wipe ? 'drewW' : 'drew', n: p.name }]; return;
    }
    case 'takeAll': {
      const k = room.table.length;
      if (!mine || room.step !== 'act' || !k) return 'no_take';
      p.hand = p.hand.concat(room.table); room.table = []; room.step = 'throw'; room.pend = k;
      room.msg = [{ k: 'tookAll', n: p.name, c: k }]; return;
    }
    case 'takeOne': {
      const i = a.i;
      if (!mine || room.step !== 'act' || room.table.length < 5 || !Number.isInteger(i) || i < 0 || i >= room.table.length) return 'no_take_one';
      p.hand.push(room.table.splice(i, 1)[0]); room.step = 'throw'; room.pend = 1;
      room.msg = [{ k: 'tookOne', n: p.name }]; return;
    }
    case 'throw': {
      const idx = a.idx;
      if (!mine || room.step !== 'throw' || !Array.isArray(idx) || idx.length !== room.pend) return 'bad_count';
      const set = new Set(idx);
      if (set.size !== idx.length || idx.some(i => !Number.isInteger(i) || i < 0 || i >= p.hand.length)) return 'bad_cards';
      const out = []; p.hand = p.hand.filter((c, i) => { if (set.has(i)) { out.push(c); return false; } return true; });
      room.table = room.table.concat(out);
      room.msg = [{ k: 'threw', n: p.name, c: out.length }];
      endTurn(room); return;
    }
    case 'declare':
      if (!mine || room.step !== 'act' || p.hand.length !== 5 || best(p.hand).t < 40) return 'need40';
      room.declarer = pi; room.parts = [pi]; room.mult = 1; room.phase = 'call';
      room.call = { kind: 'double', pending: room.players.map((x, i) => i).filter(i => i !== pi) };
      room.msg = [{ k: 'declared', n: p.name }]; return;
    case 'call': {
      const c = room.call;
      if (room.phase !== 'call' || !c || !c.pending.includes(pi)) return 'no_call';
      c.pending = c.pending.filter(i => i !== pi);
      if (a.yes) {
        room.parts.push(pi);
        if (c.kind === 'double') {
          room.mult = 2; room.msg = [{ k: 'dbl', n: p.name }];
          const rest = room.players.map((x, i) => i).filter(i => i !== room.declarer && i !== pi);
          if (rest.length) room.call = { kind: 'triple', pending: rest }; else resolve(room);
        } else { room.mult = 3; room.msg = [{ k: 'trp', n: p.name }]; resolve(room); }
      } else if (!c.pending.length) resolve(room);
      return;
    }
    case 'next':
      if (room.phase !== 'reveal') return 'not_now';
      if (room.round >= ROUNDS) room.phase = 'final'; else newRound(room);
      return;
    case 'again':
      if (room.phase !== 'final' || pi !== 0) return 'host_only';
      room.phase = 'lobby'; room.round = 0; room.res = null; room.msg = [];
      room.players.forEach(x => { x.hand = []; x.score = 0; }); return;
  }
  return 'unknown';
}

// A player who is away for 2 minutes gets a simple automatic move so nobody is stuck
function autoMove(room) {
  if (room.phase !== 'turn') return;
  const p = room.players[room.turn]; if (!p) return;
  if (room.step === 'act') {
    if (room.deck.length) act(room, p, { type: 'draw' });
    else if (room.table.length) act(room, p, { type: 'takeAll' });
    else return;
  }
  if (room.phase === 'turn' && room.step === 'throw') {
    const idx = pickBest(p.hand).toss.map(c => p.hand.indexOf(c));
    act(room, p, { type: 'throw', idx }); room.msg.unshift({ k: 'auto' });
  }
}
function arm(room) {
  clearTimeout(room.tt);
  if (room.phase === 'turn') room.tt = setTimeout(() => { autoMove(room); broadcast(room); }, 120000);
  else if (room.phase === 'call') room.tt = setTimeout(() => { if (room.phase === 'call') { resolve(room); broadcast(room); } }, 25000);
}

// ---------- what each player is allowed to see ----------
function view(room, p) {
  const pi = room.players.indexOf(p), rv = room.phase === 'reveal';
  return {
    code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS, you: pi, turn: room.turn, step: room.step, pend: room.pend,
    deck: room.deck.length, table: room.table, msg: room.msg, hand: p.hand, declarer: room.declarer, mult: room.mult, parts: room.parts,
    call: room.call ? { kind: room.call.kind, mine: room.call.pending.includes(pi), waiting: room.call.pending.length } : null,
    res: room.res,
    players: room.players.map(x => ({ name: x.name, score: x.score, count: x.hand.length, on: !!x.res, hand: rv ? x.hand : undefined }))
  };
}
function send(room, p) { try { p.res.write('data: ' + JSON.stringify(view(room, p)) + '\n\n'); } catch (e) { /* closed */ } }
function push(room) { for (const p of room.players) if (p.res) send(room, p); }
function broadcast(room) { arm(room); room.upd = Date.now(); push(room); }

// ---------- http ----------
function json(res, code, o) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function readBody(req, cb) {
  let s = ''; req.on('data', d => { s += d; if (s.length > 10000) req.destroy(); });
  req.on('end', () => { let b = {}; try { b = JSON.parse(s || '{}'); } catch (e) { /* ignore */ } cb(b); });
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/api/events' && req.method === 'GET') {
    const room = rooms.get((u.searchParams.get('code') || '').toUpperCase());
    const p = room && room.players.find(x => x.id === u.searchParams.get('pid'));
    if (!p) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    if (p.res) { try { p.res.end(); } catch (e) { /* ignore */ } }
    p.res = res; push(room);
    req.on('close', () => { if (p.res === res) { p.res = null; push(room); } });
    return;
  }
  if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
    return readBody(req, b => {
      if (u.pathname === '/api/create') {
        if (rooms.size >= 300) return json(res, 503, { error: 'full_server' });
        const room = newRoom(), p = addPlayer(room, b.name); return json(res, 200, { code: room.code, pid: p.id });
      }
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (!room) return json(res, 404, { error: 'no_game' });
      if (u.pathname === '/api/join') {
        // someone coming back with the same name takes their old seat (during a game, or in the lobby if that seat is offline)
        const nm = cleanName(b.name).toLowerCase(), old = room.players.find(x => x.name.toLowerCase() === nm);
        if (old && (room.phase !== 'lobby' || !old.res)) {
          old.id = crypto.randomBytes(12).toString('hex'); // the old device's token stops working
          if (old.res) { const r0 = old.res; old.res = null; try { r0.end(); } catch (e) { /* ignore */ } }
          push(room); return json(res, 200, { code: room.code, pid: old.id, back: true });
        }
        if (room.phase !== 'lobby') return json(res, 400, { error: 'started' });
        if (room.players.length >= MAXP) return json(res, 400, { error: 'full' });
        const p = addPlayer(room, b.name); push(room); return json(res, 200, { code: room.code, pid: p.id });
      }
      if (u.pathname === '/api/act') {
        const p = room.players.find(x => x.id === b.pid);
        if (!p) return json(res, 403, { error: 'not_in' });
        const err = act(room, p, b); if (err) return json(res, 400, { error: err });
        broadcast(room); return json(res, 200, { ok: true });
      }
      json(res, 404, { error: 'unknown' });
    });
  }
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  res.writeHead(404); res.end('Not found');
});

if (require.main === module) {
  setInterval(() => { // keep connections alive and delete games nobody has touched for 6 hours
    const now = Date.now();
    for (const [code, r] of rooms) {
      if (now - r.upd > 6 * 3600e3) { r.players.forEach(p => { try { p.res && p.res.end(); } catch (e) { /* ignore */ } }); clearTimeout(r.tt); rooms.delete(code); }
      else r.players.forEach(p => { try { p.res && p.res.write(': ping\n\n'); } catch (e) { /* ignore */ } });
    }
  }, 20000);
  server.listen(PORT, () => console.log('Declare server listening on ' + PORT));
}
module.exports = { deckSpec, rooms, newRoom, addPlayer, act, best, pickBest, view, server };
