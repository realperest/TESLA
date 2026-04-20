#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const playerHtmlPath = path.join(__dirname, '..', 'public', 'player.html');
const versionPattern = /(\d{6})\.(\d{4})/;

function todayYYMMDD() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function nextVersion(currentVersion) {
  const m = String(currentVersion || '').match(versionPattern);
  if (!m) {
    return `${todayYYMMDD()}.0001`;
  }
  const prevSeq = Number(m[2]) || 0;
  const nextSeq = prevSeq + 1;
  return `${todayYYMMDD()}.${String(nextSeq).padStart(4, '0')}`;
}

function bumpPlayerHtml() {
  if (!fs.existsSync(playerHtmlPath)) {
    throw new Error(`Dosya bulunamadi: ${playerHtmlPath}`);
  }

  const src = fs.readFileSync(playerHtmlPath, 'utf8');
  const badgeRegex = /(<span id="app-version-badge" data-version=")(\d{6}\.\d{4})(">)(\d{6}\.\d{4})(<\/span>)/;
  const match = src.match(badgeRegex);
  const current = match ? match[2] : null;
  const next = nextVersion(current);

  const updated = src.replace(badgeRegex, `$1${next}$3${next}$5`);
  if (updated === src) {
    throw new Error('Version badge guncellenemedi (regex eslesmedi).');
  }

  fs.writeFileSync(playerHtmlPath, updated, 'utf8');
  return { current, next };
}

function main() {
  const { current, next } = bumpPlayerHtml();
  process.stdout.write(`App version bumped: ${current || 'none'} -> ${next}\n`);
}

main();
