#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const directories = [root, path.join(root, 'locales')];
const files = directories.flatMap((directory) => fs.readdirSync(directory)
  .filter((name) => name.endsWith('.gs')).map((name) => path.join(directory, name)));
const failures = [];
for (const file of files) {
  try {
    new Function(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Apps Script syntax passed for ${files.length} files.`);
