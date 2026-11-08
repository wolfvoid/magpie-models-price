
const fs = require('fs');
const path = require('path');
const matcher = require('../matcher');

const report = matcher.scanAll();
const generatedAt = new Date().toISOString().slice(0, 10);
const jsContent = 'window.__MAGPIE_MODELS_DATA__ = ' + JSON.stringify(report, null, 2) + ';\n' +
  'window.__MAGPIE_MODELS_DATA_AT__ = ' + JSON.stringify(generatedAt) + ';\n';

fs.writeFileSync(path.join(__dirname, 'models-data.js'), jsContent, 'utf8');
console.log('models-data.js generated with', report.length, 'models');
