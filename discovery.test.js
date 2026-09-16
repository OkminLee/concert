const test = require('node:test');
const assert = require('node:assert/strict');
const { state, linkKey } = require('./public/discovery');
const { youtubeResults } = require('./music-search');
test('overfilled vocal does not fill an empty guitar position', () => {
  assert.deepEqual(state({ slots: { vocal: 1, guitar: 2 }, members: { vocal: ['a', 'b', 'c'], guitar: [] } }), { cap: 3, filled: 1, left: 2, id: 'start' });
});
test('zero capacity is unset even when people have signed up', () => {
  assert.equal(state({ slots: { vocal: 0 }, members: { vocal: ['a'] } }).id, 'unset');
});
test('one remaining place takes precedence over the early-stage label', () => {
  assert.equal(state({ slots: { guitar: 2 }, members: { guitar: ['a'] } }).id, 'near');
});
test('full requires each configured part to be filled', () => {
  assert.equal(state({ slots: { vocal: 1, guitar: 1 }, members: { vocal: ['a', 'b'], guitar: ['c'] } }).id, 'full');
});
test('source links normalize tracking and alternate YouTube formats', () => {
  assert.equal(linkKey('https://youtu.be/abc123?si=tracking'), linkKey('https://www.youtube.com/watch?v=abc123&list=playlist'));
  assert.equal(linkKey('https://music.apple.com/kr/album/name/123?i=456'), linkKey('https://music.apple.com/us/song/name/456'));
  assert.notEqual(linkKey('https://music.apple.com/kr/album/name/123?i=456'), linkKey('https://music.apple.com/kr/album/name/123?i=457'));
});
test('YouTube parser handles nested renderers and deduplicates videos', () => {
  const v = { videoRenderer: { videoId: 'abc123', title: { runs: [{ text: 'Live ' }, { text: 'song' }] }, ownerText: { runs: [{ text: 'Artist' }] }, lengthText: { simpleText: '4:12' } } };
  const html = '<script>var ytInitialData = ' + JSON.stringify({ contents: [v, { nested: [v] }] }) + ';</script>';
  const results = youtubeResults(html);
  assert.equal(results.length, 1); assert.equal(results[0].title, 'Live song'); assert.equal(results[0].artist, 'Artist');
});
test('a changed YouTube response is an explicit failure, not a fake empty result', () => {
  assert.throws(() => youtubeResults('<html>changed</html>'), /읽지 못했어요/);
});
