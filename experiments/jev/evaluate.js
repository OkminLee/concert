const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { questions, keyword, decode } = require('./classify');
function metrics(rows, labels) {
  let knownKinds = 0, correctKinds = 0, emitted = 0, correctBadges = 0, unknownBadges = 0, possible = 0;
  for (const row of rows) {
    const gold = labels[row.id];
    if (gold.kind !== 'unknown') { knownKinds++; correctKinds += Number(row.prediction.kind === gold.kind); }
    for (const key of ['live', 'cover', 'tutorial']) {
      const expected = key === 'tutorial' ? gold.kind === 'unknown' ? null : gold.kind === 'tutorial' : gold[key];
      const actual = key === 'tutorial' ? row.prediction.kind === 'tutorial' : row.prediction[key];
      if (expected === true) possible++;
      if (actual) { emitted++; correctBadges += Number(expected === true); unknownBadges += Number(expected === null); }
    }
  }
  return { samples: rows.length, knownKinds, kindAccuracy: knownKinds ? correctKinds / knownKinds : null,
    emittedBadges: emitted, supportedBadges: correctBadges, badgesOnUnknown: unknownBadges,
    badgePrecision: emitted ? correctBadges / emitted : null, badgeRecall: possible ? correctBadges / possible : null,
    coverage: rows.filter(r => r.prediction.kind === 'tutorial' || r.prediction.live || r.prediction.cover).length / rows.length };
}
async function main() {
  const { samples } = JSON.parse(fs.readFileSync(path.join(__dirname, 'samples.json'), 'utf8'));
  const labelFile = path.join(__dirname, 'labels.json');
  if (!fs.existsSync(labelFile)) throw new Error('Create and review labels.json before model evaluation.');
  const { labels, provenance } = JSON.parse(fs.readFileSync(labelFile, 'utf8'));
  for (const sample of samples) {
    const g = labels[sample.id];
    if (!g || !Object.hasOwn(questions.kind.criteria, g.kind) || ![g.live, g.cover].every(v => v === null || typeof v === 'boolean')) throw new Error('Invalid/missing label: ' + sample.id);
  }
  const baseline = samples.map(s => ({ id: s.id, prediction: keyword(s) }));
  console.log(JSON.stringify({ provenance, keyword: metrics(baseline, labels) }, null, 2));
  if (!process.argv.includes('--jev')) return;
  const output = path.join(__dirname, 'jev-results.json');
  const log = path.join(__dirname, 'jev-responses.jsonl');
  if (fs.existsSync(output) || fs.existsSync(log)) throw new Error('Results already exist; refusing duplicate API spend.');
  const keyFile = path.join(os.homedir(), '.concert/typesafe.json');
  const key = process.env.TYPESAFE_API_KEY || (fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')).api_key : '');
  if (!key) throw new Error('TYPESAFE_API_KEY is not configured.');
  fs.writeFileSync(log, '', { flag: 'wx', mode: 0o600 });
  const rows = [];
  for (const sample of samples) {
    const start = performance.now();
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: JSON.stringify({ title: sample.title, channel: sample.artist }), questions }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Jev HTTP ' + response.status + '; completed responses preserved, no retry.');
    const result = await response.json();
    const row = { id: sample.id, ms: Math.round(performance.now() - start), prediction: decode(result), model: result.model, answers: result.answers, usage: result.usage };
    fs.appendFileSync(log, JSON.stringify(row) + '\n'); rows.push(row);
    console.log('Evaluated ' + rows.length + '/' + samples.length);
  }
  const timings = rows.map(r => r.ms).sort((a, b) => a - b);
  const report = { evaluatedAt: new Date().toISOString(), provenance, thresholds: { choiceConfidence: 0.7, positiveNoul: 0.9 }, keyword: metrics(baseline, labels), jev: metrics(rows, labels),
    latencyMs: { p50: timings[Math.ceil(timings.length * 0.5) - 1], p95: timings[Math.ceil(timings.length * 0.95) - 1] },
    usage: rows.reduce((a, r) => ({ input_tokens: a.input_tokens + (r.usage?.input_tokens || 0), output_tokens: a.output_tokens + (r.usage?.output_tokens || 0) }), { input_tokens: 0, output_tokens: 0 }), rows };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { metrics };
