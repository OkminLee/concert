const test = require('node:test');
const assert = require('node:assert/strict');
const { createLabeler, badgesFrom } = require('./music-labels');
const item = { provider: 'youtube', id: 'abc', title: 'Live cover', artist: 'Band' };
const response = (choice = 'music', confidence = 1) => ({ answers: { kind: { choice, confidence }, live: { noul: 0.99 }, cover: { noul: 0.99 } } });
test('independent live/cover badges; tutorials and uncertainty do not become music badges', () => {
  assert.deepEqual(badgesFrom(response()), ['live', 'cover']);
  assert.deepEqual(badgesFrom(response('tutorial')), ['tutorial']);
  assert.deepEqual(badgesFrom(response('music', 0.2)), []);
  assert.throws(() => badgesFrom({ answers: {} }), /schema/);
});
test('duplicate in-flight and cached results share one request; request excludes private data', async () => {
  let calls = 0;
  const labeler = createLabeler({ apiKey: 'test-only', fetcher: async (_, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(body.model, 'jev-1.13.0');
    assert.equal(body.state.includes('PRIVATE'), false);
    await new Promise(r => setTimeout(r, 15));
    return { ok: true, json: async () => response() };
  } });
  const results = await Promise.all([labeler.classify([{ ...item, member: 'PRIVATE' }]), labeler.classify([item])]);
  await labeler.classify([item]);
  assert.equal(calls, 1); assert.deepEqual(results[0][0].badges, ['live', 'cover']);
});
test('failed API calls omit badges, cache failure briefly and never log credentials', async () => {
  let time = 0, calls = 0; const logs = [];
  const labeler = createLabeler({ apiKey: 'secret-not-for-logs', now: () => time, log: message => logs.push(message), fetcher: async () => {
    calls++; throw new Error('secret-not-for-logs');
  } });
  assert.equal((await labeler.classify([item]))[0].unavailable, true);
  await labeler.classify([item]); assert.equal(calls, 1);
  time = 60001; await labeler.classify([item]); assert.equal(calls, 2);
  assert.equal(logs.join('').includes('secret-not-for-logs'), false);
});
test('missing key makes no API calls and concurrency is capped at four', async () => {
  let running = 0, peak = 0;
  const fetcher = async () => { peak = Math.max(peak, ++running); await new Promise(r => setTimeout(r, 10)); running--; return { ok: true, json: async () => response() }; };
  assert.equal((await createLabeler({ apiKey: '', fetcher }).classify([item]))[0].unavailable, true);
  assert.equal(peak, 0);
  await createLabeler({ apiKey: 'test', fetcher }).classify(Array.from({ length: 12 }, (_, i) => ({ ...item, id: String(i) })));
  assert.equal(peak, 4);
});
test('labels route requires a server search cache entry and never accepts client metadata', async () => {
  const routes = new Map(); let called = false;
  require('./music-search').install({ get: (route, handler) => routes.set(route, handler) }, () => '', { classify: async () => { called = true; return []; } });
  const res = { status(n) { this.code = n; return this; }, json(x) { this.body = x; return this; } };
  await routes.get('/api/music-labels')({ query: { provider: 'youtube', q: 'never searched', title: 'attacker input' } }, res);
  assert.equal(res.code, 410); assert.equal(called, false);
});
