#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';

const output = resolve(process.argv[2] || '/home/agent/workspace/browser-smoke');
const publicCheck = process.env.BROWSER_SMOKE_PUBLIC === '1';
assert.equal(process.getuid(), 1000, 'smoke must run as agent UID 1000');
assert.ok(process.release.lts, 'Node must be LTS');
mkdirSync(output);
const payload = 'Browser Kit download: 中文 日本語 한국어 😀\n';
const server = createServer((request, response) => {
  if (request.url === '/download') {
    response.writeHead(200, {'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="download.txt"'});
    response.end(payload);
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>Browser Kit CJK</title>' +
      '<h1>Browser Kit: 中文 日本語 한국어 😀</h1><a href="/download" download>Download file</a>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const session = `smoke-${process.pid}`;
// Keep the HTTP server responsive while the CLI waits for browser requests.
async function browser(...args) {
  return await new Promise((resolve, reject) => {
    const child = spawn('agent-browser', ['--session', session, ...args], {timeout: 60000});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout) :
      reject(new Error(`agent-browser ${args[0]} exited ${code}: ${stderr}${stdout}`)));
  });
}
try {
  const publicPages = publicCheck ? [
    ['example', 'https://example.com', /Example Domain|documentation examples/],
    ['wikipedia', 'https://en.wikipedia.org', /Wikipedia/],
    ['wikipedia-ja', 'https://ja.wikipedia.org', /ウィキペディア/],
  ] : [];
  for (const [name, url, expected] of publicPages) {
    await browser('open', url);
    const snapshot = await browser('snapshot');
    assert.match(snapshot, expected);
    writeFileSync(`${output}/${name}-snapshot.txt`, snapshot);
    await browser('screenshot', `${output}/${name}.png`);
    console.log(`PASS: open, snapshot, screenshot ${url}`);
  }
  await browser('open', `http://127.0.0.1:${server.address().port}`);
  const snapshot = await browser('snapshot');
  assert.match(snapshot, /中文 日本語 한국어/);
  writeFileSync(`${output}/snapshot.txt`, snapshot);
  await browser('screenshot', `${output}/cjk.png`);
  await browser('download', 'a', `${output}/download.txt`);
  assert.equal(readFileSync(`${output}/download.txt`, 'utf8'), payload);
  for (const name of ['cjk.png', ...publicPages.map(([name]) => `${name}.png`)]) {
    assert.equal(readFileSync(`${output}/${name}`).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  console.log('PASS: UID 1000, Node LTS, loopback open, snapshot, CJK screenshot, browser download (exact bytes)');
  console.log(`Artifacts: ${output}`);
} finally {
  await browser('close');
  server.close();
}
