'use strict';
/** Loads a dependency-free TypeScript source file (the region registry / region rules) into Node without a build step. */
const fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
function loadTs(rel) {
  const ts = require(path.join(REPO, 'frontEnd', 'node_modules', 'typescript'));
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out)(m, m.exports, require);
  return m.exports;
}
module.exports = { REPO, loadTs };
