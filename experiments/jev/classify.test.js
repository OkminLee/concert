const test = require('node:test');
const assert = require('node:assert/strict');
const { keyword, decode } = require('./classify');
const { metrics } = require('./evaluate');
test('live covers can receive both labels; tutorial wins over cover keywords', () => {
  assert.deepEqual(keyword({ title: 'Live cover', artist: 'Band' }), { kind: 'music', live: true, cover: true });
  assert.deepEqual(keyword({ title: 'cover guitar lesson', artist: 'Teacher' }), { kind: 'tutorial', live: false, cover: false });
});
test('uncertain content suppresses badges and malformed responses fail explicitly', () => {
  const answers = { kind: { choice: 'music', confidence: 0.2 }, live: { noul: 0.99 }, cover: { noul: 0.99 } };
  assert.deepEqual(decode({ answers }), { kind: 'unknown', live: false, cover: false });
  assert.throws(() => decode({ answers: { ...answers, live: { noul: 2 } } }), /schema/);
});
test('unsupported positives count against precision; omitted known badges count against recall', () => {
  const rows = [{ id: 'a', prediction: { kind: 'music', live: true, cover: false } }, { id: 'b', prediction: { kind: 'unknown', live: false, cover: false } }];
  const labels = { a: { kind: 'music', live: null, cover: true }, b: { kind: 'music', live: true, cover: false } };
  const result = metrics(rows, labels);
  assert.equal(result.badgePrecision, 0); assert.equal(result.badgeRecall, 0); assert.equal(result.badgesOnUnknown, 1);
});
