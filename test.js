#!/usr/bin/env node
// Test runner — no framework. Each tests/*.test.js exports [{name, fn}]; fn throws on failure.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'tests');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

let pass = 0, fail = 0;
const failures = [];
for (const file of files) {
  const tests = require(path.join(dir, file));
  for (const { name, fn } of tests) {
    try {
      fn();
      pass++;
    } catch (err) {
      fail++;
      failures.push({ file, name, err });
      console.log(`FAIL [${file}] ${name}`);
      console.log(`     ${err.message}`);
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${files.length} files`);
if (failures.length) process.exit(1);
