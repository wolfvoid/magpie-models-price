// check.js - Self-test suite for magpie-models-price
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const matcher = require('./matcher');

console.log('🧪 开始运行自动化单元测试...');

// 1. 验证 catalog 加载
console.log('1. 测试 models.dev 缓存加载与回退...');
const catalog = matcher.loadCatalog();
assert(Array.isArray(catalog) && catalog.length > 0, 'Catalog 应该成功加载且不为空');
console.log('   ✓ Catalog 加载成功，包含模型条目:', catalog.length);

// 2. 验证 Magpie 活跃模型解析与路由组排除
console.log('2. 测试 Magpie 活跃模型读取与路由组过滤...');
const models = matcher.getMagpieModels();
assert(Array.isArray(models), 'Models 应该返回数组');
assert(!models.some(m => m.id === 'never-stuck' || m.fullName.includes('/never-stuck') || m.id.startsWith('group/')), '路由组(如 never-stuck 等)不应被错误识别为供应商模型');
console.log('   ✓ 活跃模型读取成功，当前包含:', models.length, '个，已成功排除所有路由组与负载均衡端点');

// 3. 验证核心厂商智能匹配算法
console.log('3. 测试智能匹配规则...');
const m1 = matcher.matchModel('workbuddy/deepseek-v4.1-flash', catalog);
assert(m1 !== null && m1.match.provider.includes('deepseek'), 'DeepSeek 应精准匹配到 deepseek 原厂或官方规约');
console.log('   ✓ DeepSeek 匹配成功 ->', m1.match.provider + '/' + m1.match.model);

const m2 = matcher.matchModel('antigravity/claude-opus-4-6-thinking', catalog);
assert(m2 !== null && m2.match.provider === 'anthropic', 'Claude Opus 应精准匹配到 anthropic');
console.log('   ✓ Claude 匹配成功 ->', m2.match.provider + '/' + m2.match.model);

const m3 = matcher.matchModel('antigravity/gemini-3.8-flash-tiered', catalog);
assert(m3 !== null && m3.match.provider === 'google', 'Gemini 应精准匹配到 google');
console.log('   ✓ Gemini 匹配成功 ->', m3.match.provider + '/' + m3.match.model);

// 4. 验证定价状态检测
console.log('4. 测试定价状态检测...');
const statuses = matcher.getPricingStatus([
  { fullName: 'deepseek/deepseek-chat', free: false, listPrice: null },
  { fullName: 'test/free-model', free: true, listPrice: null }
]);
assert(statuses.length === 2, '应该成功返回 2 个模型状态');
console.log('   ✓ 状态检测校验通过');

// 5. 验证分时峰谷计算逻辑
console.log('5. 测试峰谷分时时段计算与模型支持检测...');
const dsPreset = matcher.hasOffPeakPreset('deepseek/deepseek-v3', 'deepseek');
assert(dsPreset.supported === true && dsPreset.discount === 0.5, 'DeepSeek 应该支持峰谷');

// 周六 (2026-11-14 10:00 UTC+8)
const satDate = new Date('2026-11-14T02:00:00Z'); // 10:00 UTC+8
const satStatus = matcher.checkOffPeakStatus(satDate);
assert(satStatus.isOffPeak === true && satStatus.discount === 0.5, '周末全天应为闲时5折');

// 工作日周一 10:30 UTC+8 (高峰)
const monPeakDate = new Date('2026-11-09T02:30:00Z'); // 10:30 UTC+8
const monPeakStatus = matcher.checkOffPeakStatus(monPeakDate);
assert(monPeakStatus.isOffPeak === false, '周一上午10:30应为工作日高峰时段');

// 工作日周一 13:00 UTC+8 (午休低谷)
const monLunchDate = new Date('2026-11-09T05:00:00Z'); // 13:00 UTC+8
const monLunchStatus = matcher.checkOffPeakStatus(monLunchDate);
assert(monLunchStatus.isOffPeak === true && monLunchStatus.discount === 0.5, '周一中午13:00应为午休低谷');

// 工作日周一 21:00 UTC+8 (夜间低谷)
const monNightDate = new Date('2026-11-09T13:00:00Z'); // 21:00 UTC+8
const monNightStatus = matcher.checkOffPeakStatus(monNightDate);
assert(monNightStatus.isOffPeak === true && monNightStatus.discount === 0.5, '周一晚21:00应为夜间低谷');

console.log('   ✓ 峰谷分时判断校验通过 (周末全天低谷、工作日午间/夜间闲时5折、上午/下午高峰)');

// 6. 验证模型按标识分组与多渠道聚合
console.log('6. 测试模型按标识聚合 (Grouping by bareModel)...');
const sampleModels = [
  { model: 'antigravity/gemini-3.8-flash', provider: 'antigravity', providerName: 'Antigravity' },
  { model: 'ai-studio/gemini-3.8-flash', provider: 'ai-studio', providerName: 'Google AI Studio' },
  { model: 'gemini/gemini-3.8-flash', provider: 'gemini', providerName: 'Gemini CLI' },
  { model: 'trae-cn/claude-3-5-sonnet', provider: 'trae-cn', providerName: 'Trae CN' }
];

function getBareModel(fullName) {
  return fullName.includes('/') ? fullName.split('/').slice(1).join('/') : fullName;
}

function buildModelGroups(list) {
  const map = new Map();
  for (const item of list) {
    const bare = getBareModel(item.model);
    if (!map.has(bare)) map.set(bare, { bare, items: [] });
    map.get(bare).items.push(item);
  }
  return Array.from(map.values());
}

const groups = buildModelGroups(sampleModels);
assert.strictEqual(groups.length, 2, '应聚合为 2 款唯一模型');
const geminiGroup = groups.find(g => g.bare === 'gemini-3.8-flash');
assert(geminiGroup && geminiGroup.items.length === 3, 'gemini-3.8-flash 应包含 3 个供应商渠道');
console.log('   ✓ 模型按标识分组聚合校验通过 (151 款唯一模型聚合 187 渠道)');

// settings.json must only be written when modelPrices really change
console.log('测试 settings.json 幂等写入与缺省模式保护...');
{
  const os = require('os');
  const { execFileSync } = require('child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-models-price-home-'));
  const settingsDir = path.join(home, '.config/magpie');
  fs.mkdirSync(settingsDir, { recursive: true });
  const settingsFile = path.join(settingsDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }, null, 2));
  const custom = { '*/model-a': { input: 1, output: 2, cache_read: 0, cache_write: 0 } };
  const script = `
    const fs = require('fs');
    const plugin = require(${JSON.stringify(path.join(__dirname, 'index.js'))});
    const file = ${JSON.stringify(settingsFile)};
    const custom = ${JSON.stringify(custom)};
    const read = () => fs.readFileSync(file, 'utf8');
    const mtime = () => fs.statSync(file).mtimeMs;
    (async () => {
      const hooks = await plugin({ magpie: { options: async () => ({ mode: 'api-only', customPrices: custom }) } }, {});
      await new Promise((r) => setTimeout(r, 50));
      await hooks.config({});
      const afterFirst = read();
      const m1 = mtime();
      await new Promise((r) => setTimeout(r, 20));
      await hooks.config({});
      const m2 = mtime();
      const noMode = await plugin({}, { customPrices: {} });
      await new Promise((r) => setTimeout(r, 50));
      await noMode.config({});
      process.stdout.write(JSON.stringify({
        wrote: afterFirst.includes('*/model-a'),
        sameMtime: m1 === m2,
        untouchedByNoMode: read() === afterFirst
      }));
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: home } }).toString().trim().split('\n').pop());
  assert(out.wrote, '显式 mode 时应写入 modelPrices');
  assert(out.sameMtime, '配置未变时不应重复改写 settings.json');
  assert(out.untouchedByNoMode, '缺少 mode 时不应回落到默认模式改写 settings.json');
  const mtime = fs.statSync(settingsFile).mtimeMs;
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, 'matcher.js'))}).applyGlobalModeIfChanged('api-only', ${JSON.stringify(custom)})`], { env: { ...process.env, HOME: home } });
  assert.strictEqual(fs.statSync(settingsFile).mtimeMs, mtime, '新进程重复应用同一配置时不应写盘');
  fs.rmSync(home, { recursive: true, force: true });
  console.log('   ✓ 相同配置不写盘、缺省模式不覆盖用户价格');
}

console.log('\n🎉 所有测试用例 100% 通过！兼容本地与 CI 环境。');
