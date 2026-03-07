const fs = require('fs');
const glob = require('fast-glob');
const files = glob.sync('src/channels/**/*.ts');
for (const file of files) {
  if (file === 'src/channels/index.ts' || file === 'src/channels/core.ts') continue;
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes("from '../index.js'")) {
    content = content.replace(/from '\.\.\/index\.js'/g, "from '../core.js'");
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
  }
}
