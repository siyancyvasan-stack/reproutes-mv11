const fs = require('fs');
const path = require('path');
const glob = require('glob');

const files = glob.sync('src/**/*.ts');
let changed = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  let newContent = content
    .replace(/,\s*mode:\s*['"]insensitive['"](?:\s*as\s*const)?/g, '')
    .replace(/mode:\s*['"]insensitive['"](?:\s*as\s*const)?\s*,/g, '');
  if (newContent !== content) {
    fs.writeFileSync(file, newContent, 'utf8');
    changed++;
    console.log('Updated', file);
  }
}
console.log('Total changed:', changed);
