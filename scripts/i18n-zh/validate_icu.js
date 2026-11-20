// 用 formatjs 的 ICU parser 校验合并后的 zh-CN 文案，输出无法解析的条目
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { parse } = require(path.join(ROOT, 'node_modules/@formatjs/icu-messageformat-parser'));

const file = process.argv[2] || path.join(__dirname, 'zh-CN.merged.json');
const msgs = JSON.parse(fs.readFileSync(file, 'utf8'));
const bad = [];
for (const [id, msg] of Object.entries(msgs)) {
  try {
    parse(msg, { requiresOtherClause: false });
  } catch (e) {
    bad.push({ id, error: String(e.message || e), msg });
  }
}
console.log(`checked=${Object.keys(msgs).length} bad=${bad.length}`);
fs.writeFileSync(path.join(__dirname, 'icu_bad.json'), JSON.stringify(bad, null, 2));
for (const b of bad.slice(0, 20)) console.log('BAD', b.id, '|', b.error, '|', b.msg.slice(0, 100));
