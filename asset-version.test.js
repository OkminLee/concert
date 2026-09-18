const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
test('search JS and CSS URLs change whenever their bytes change, bypassing four-hour browser cache', () => {
  const root = path.join(__dirname, 'public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const file of ['app.js', 'discovery.css']) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 12);
    assert.ok(html.includes(file + '?v=' + digest + '"'), file + ' must use its current content hash in index.html');
  }
});
