#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('../assets/script-template.js');
const checker = require('../assets/app.js');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const archive = path.join(dist, 'JavaIDEA-checker.zip');
const offline = path.join(dist, 'JavaIDEA自检工具-离线版.html');
const sums = path.join(dist, 'SHA256SUMS.txt');

function build() {
  const bytes = Buffer.from(checker.createZip(checker.packageEntries()));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(archive, bytes);
  const lines = [hash + '  JavaIDEA-checker.zip'];
  if (fs.existsSync(offline)) {
    const offlineHash = crypto.createHash('sha256').update(fs.readFileSync(offline)).digest('hex');
    lines.push(offlineHash + '  JavaIDEA-checker-offline.html');
  }
  fs.writeFileSync(sums, lines.join('\n') + '\n', 'utf8');
  return { archive, hash, sums };
}

if (require.main === module) {
  const result = build();
  process.stdout.write(result.hash + '  ' + path.relative(root, result.archive) + '\n');
}

module.exports = { build };
