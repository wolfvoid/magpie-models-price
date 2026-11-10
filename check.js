// check.js - Self-test suite for magpie-models-price
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const matcher = require('./matcher');
const MM = require('./page/my-models');

console.log('🧪 开始运行自动化单元测试...');

// 1. 验证 catalog 加载
console.log('1. 测试 models.dev 缓存加载与回退...');
const catalog = matcher.loadCatalog();
assert(Array.isArray(catalog) && catalog.length > 0, 'Catalog 应该成功加载且不为空');
console.log('   ✓ Catalog 加载成功，包含模型条目:', catalog.length);

// 2. 验证 Magpie 活跃模型解析
console.log('2. 测试 Magpie 活跃模型读取...');
const models = matcher.getMagpieModels();
assert(Array.isArray(models), 'Models 应该返回数组');
console.log('   ✓ 活跃模型读取成功，当前包含:', models.length, '个');

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

// 6. My Models: price parsing and source detection
console.log('6. 测试 My Models 价格解析与来源识别...');
const parsedList = MM.parseCurrentPrice('List: $1.25/$5 in/out');
assert(parsedList.source === 'list' && parsedList.input === 1.25 && parsedList.output === 5, 'List 价格应解析为渠道价');
const parsedCustom = MM.parseCurrentPrice('Custom: $0.5/$3 in/out (cache: $0.05/$0.1)');
assert(parsedCustom.source === 'custom' && parsedCustom.cache_read === 0.05 && parsedCustom.cache_write === 0.1, 'Custom 价格应解析缓存读写');
assert(MM.parseCurrentPrice('Free model ($0.00)').source === 'free', '免费模型应识别为免费');
assert(MM.parseCurrentPrice('no price is known for it') === null, '未知价格不得被当作 0');
assert.strictEqual(MM.formatPrice(5), '$5', '整数价格不应显示尾随 .0');
assert.strictEqual(MM.formatPrice(0.6), '$0.6', '小数价格应保留有效位数');
assert.strictEqual(MM.formatPrice(0.003), '$0.003', '小额缓存价格不应被截断');
assert.strictEqual(MM.formatPrice(null), '—', '未知价格应显示占位符');
console.log('   ✓ 列表价、自定义价、免费价与未知价格区分正确');

// 7. My Models: configured providers, custom precedence, reference-only
console.log('7. 测试 My Models 渠道过滤与价格优先级...');
const fixtureModels = [
  {
    model: 'alpha/model-one', provider: 'alpha', providerName: 'Alpha', providerKind: 'api',
    name: 'Model One', currentPrice: 'List: $1/$2 in/out',
    matched: { provider: 'vendor', model: 'model-one', cost: { input: 0.5, output: 1.5, cache_read: 0.1, cache_write: 0 } }
  },
  {
    model: 'beta/model-one', provider: 'beta', providerName: 'Beta', providerKind: 'api',
    name: 'Model One', currentPrice: 'Custom: $0.4/$0.8 in/out (cache: $0.1/$0)',
    matched: null
  },
  { model: 'beta/model-two', provider: 'beta', providerName: 'Beta', providerKind: 'api', name: 'Model Two', currentPrice: 'no price is known for it', matched: null },
  { model: 'gamma/model-three', provider: 'gamma', providerName: 'Gamma', providerKind: 'api', name: 'Model Three', currentPrice: 'Free model ($0.00)', matched: null },
  {
    model: 'epsilon/model-one', provider: 'epsilon', providerName: 'Epsilon', providerKind: 'api',
    name: 'Model One', currentPrice: 'no price is known for it',
    matched: { provider: 'vendor', model: 'model-one', cost: { input: 9, output: 10, cache_read: 0, cache_write: 0 } }
  },
  { model: 'deleted/model-old', provider: 'deleted', providerName: 'Deleted', providerKind: 'api', name: 'Old', currentPrice: 'List: $1/$1 in/out', matched: null },
  {
    model: 'sub/model-one', provider: 'sub', providerName: 'Sub', providerKind: 'subscription',
    name: 'Model One', currentPrice: 'List: $3/$15 in/out',
    matched: { provider: 'vendor', model: 'model-one', cost: { input: 3, output: 15, cache_read: 0, cache_write: 0 } }
  }
];
const fixtureProviders = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma' },
  { id: 'epsilon', name: 'Epsilon' },
  { id: 'sub', name: 'Sub' }
];
const rows = MM.buildRows(fixtureModels, { providers: fixtureProviders, customPrices: {}, mode: 'all-equivalent' });
assert(rows.length === 6, 'My Models 只应包含已配置渠道的模型');
assert(!rows.some((r) => r.provider === 'deleted'), '已删除渠道不得出现在表格中');

const alpha = rows.find((r) => r.key === 'alpha/model-one');
assert(alpha.price.source === 'list' && alpha.price.input === 1, '列表价应标记为渠道价');
assert(alpha.reference && alpha.reference.input === 0.5, 'models.dev 公价应保留为参考值');
const alphaCustom = MM.buildRows(fixtureModels, {
  providers: fixtureProviders,
  customPrices: { 'alpha/model-one': { input: 0.25, output: 0.75, cache_read: 0.05, cache_write: 0 }, '*/model-two': { input: 2, output: 4 } },
  mode: 'all-equivalent'
}).find((r) => r.key === 'alpha/model-one');
assert(alphaCustom.price.source === 'custom' && alphaCustom.price.input === 0.25, '渠道自定义价应优先于列表价');
const betaWildcard = MM.buildRows(fixtureModels, {
  providers: fixtureProviders,
  customPrices: { '*/model-two': { input: 2, output: 4, cache_read: 0, cache_write: 0 } },
  mode: 'all-equivalent'
}).find((r) => r.key === 'beta/model-two');
assert(betaWildcard.price.source === 'wildcard', '通配自定义价应生效');

const epsilon = rows.find((r) => r.key === 'epsilon/model-one');
assert(epsilon.price.source === 'reference' && epsilon.applied === false, '未应用的公价只能是参考价');
assert(MM.buildRows(fixtureModels, { providers: fixtureProviders, customPrices: {}, mode: 'all-equivalent' })
  .find((r) => r.key === 'beta/model-two').price === null, '未知价格必须保持为空，不能当作 0');
const subZero = MM.buildRows(fixtureModels, { providers: fixtureProviders, customPrices: {}, mode: 'api-only' })
  .find((r) => r.key === 'sub/model-one');
assert(subZero.price.source === 'subscription-zero' && subZero.price.input === 0, '仅真实 API 模式下订阅渠道应为 0');
console.log('   ✓ 已配置渠道、自定义优先级、参考价与订阅口径正确');

// 8. My Models: combined filters, search and sorting
console.log('8. 测试 My Models 组合筛选与排序...');
const filtered = MM.filterRows(rows, {
  providers: ['alpha', 'beta', 'gamma'],
  favorites: new Set(['beta/model-one']),
  onlyFavorites: true,
  query: 'model one'
});
assert(filtered.length === 1 && filtered[0].key === 'beta/model-one', '收藏、渠道、搜索应同时生效');
assert(MM.filterRows(rows, { providers: [], query: '' }).length === 0, '全不选渠道应返回空结果');
assert(MM.filterRows(rows, { query: '不存在的模型' }).length === 0, '空搜索结果应为空');
assert(MM.filterRows(rows, { hideUnpriced: true }).every((r) => MM.hasPrice(r)), '隐藏未知价格应过滤无价模型');

const sortedAsc = MM.sortRows(rows, { key: 'input', dir: 'asc' });
assert(sortedAsc[sortedAsc.length - 1].price === null, '价格排序应把未知价格放在最后');
const sortedDesc = MM.sortRows(rows, { key: 'input', dir: 'desc' });
assert(sortedDesc[0].key === 'epsilon/model-one' && sortedDesc[0].price.input === 9, '输入价格降序应把最高价放在最前');
assert(MM.sortRows(rows, { key: 'provider', dir: 'asc' })[0].providerName === 'Alpha', '供应商升序应正确排序');
console.log('   ✓ 搜索、渠道、收藏、未知价格筛选与升降序正确');

// 9. My Models: comparison groups and persisted selection reconciliation
console.log('9. 测试跨渠道对比与已保存筛选状态...');
const groups = MM.groupByModel(rows);
const modelOne = groups.find((g) => g.bare === 'model-one');
assert(modelOne && modelOne.providerCount === 4, '同一模型在四个渠道应可对比');
assert(modelOne.comparable, '多渠道路由应标记为可比较');
assert(!groups.some((g) => g.bare.toLowerCase() === 'model_one'), '不同模型 ID 不得被强行合并');
assert(MM.groupByModel([{ ...alpha, key: 'alpha/model-one-alias', bare: 'model-one-alias' }])[0].providerCount === 1, '别名不得与原名合并');
assert.deepStrictEqual(MM.reconcileProviders(['a', 'b'], ['b', 'gone']), ['b'], '已删除渠道应从筛选中移除');
assert.deepStrictEqual(MM.reconcileProviders(['a', 'b'], null), ['a', 'b'], '未保存筛选时应默认全选');
const pruned = MM.pruneFavorites(['a/one', 'gone/two'], ['a/one']);
assert.deepStrictEqual(pruned.kept, ['a/one'], '有效收藏应保留');
assert.deepStrictEqual(pruned.stale, ['gone/two'], '失效收藏应被识别而不是崩溃');
console.log('   ✓ 对比分组、渠道重建与收藏安全处理正确');

// 10. Live snapshot writer used by Magpie host hooks
console.log('10. 测试宿主实时模型快照写入...');
(async () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { pathToFileURL } = require('url');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'magpie-models-price-live-'));
  process.env.MAGPIE_MODELS_PRICE_PAGE = tmp;
  const hooks = await import(pathToFileURL(path.join(__dirname, 'price.hooks.mjs')).href);
  const first = hooks.writeSnapshot();
  assert(first.ok, '首次写入实时快照应成功: ' + (first.error || ''));
  const live = path.join(tmp, 'models-live.js');
  assert(fs.existsSync(live), '应生成 page/models-live.js');
  const body = fs.readFileSync(live, 'utf8');
  assert(body.includes('window.__MAGPIE_MODELS_DATA__'), '快照应导出模型数组');
  assert(body.includes('window.__MAGPIE_MODELS_DATA_LIVE__ = true'), '快照应标记为 live');
  const second = hooks.writeSnapshot();
  assert(second.ok && second.unchanged === true, '内容未变时应跳过重复写入');
  hooks.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.MAGPIE_MODELS_PRICE_PAGE;
  console.log('   ✓ 宿主实时快照写入、幂等跳过与清理正确');
  console.log('\n🎉 所有测试用例 100% 通过！兼容本地与 CI 环境。');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
