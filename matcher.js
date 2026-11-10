// matcher.js - Core logic for matching Magpie models with models.dev data & pricing modes
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CACHE_MODELS_PATH = path.join(HOME, '.cache/magpie/models.json');
const PROVIDERS_STATE_PATH = path.join(HOME, '.cache/magpie/providers-state.json');
const SETTINGS_PATH = path.join(HOME, '.config/magpie/settings.json');

// Preferred official makers in models.dev
const OFFICIAL_MAKERS = [
  'deepseek', 'google', 'anthropic', 'openai', 'zhipu', 'zhipuai',
  'moonshot', 'moonshotai', 'bytedance', 'volcengine', 'baichuan',
  'minimax', 'stepfun', 'xiaomi', 'tencent', 'qwen', 'alibaba'
];

function getVendorHints(target) {
  const t = target.toLowerCase();
  if (t.includes('qwen') || t.startsWith('qwenwork/')) return ['qwen', 'alibaba'];
  if (t.includes('deepseek')) return ['deepseek'];
  if (t.includes('gemini') || t.startsWith('gemini/')) return ['google'];
  if (t.includes('claude')) return ['anthropic'];
  if (t.includes('gpt-') || t.includes('codex/')) return ['openai'];
  if (t.includes('kimi')) return ['moonshot', 'moonshotai'];
  if (t.includes('glm')) return ['zhipu', 'zhipuai'];
  if (t.includes('doubao') || t.includes('seed-')) return ['bytedance', 'volcengine'];
  if (t.includes('minimax')) return ['minimax'];
  if (t.includes('mimo')) return ['xiaomi'];
  if (t.includes('hy3') || t.includes('hy4') || t.includes('hunyuan')) return ['tencent'];
  if (t.includes('step-')) return ['stepfun'];
  return [];
}

function loadCatalog() {
  let raw = null;
  if (fs.existsSync(CACHE_MODELS_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CACHE_MODELS_PATH, 'utf8'));
    } catch {}
  }

  // Fallback for CI/testing when Magpie cache hasn't been created yet
  if (!raw) {
    return [
      { provider: 'deepseek', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', cost: { input: 0.15, output: 0.6, cache_read: 0.003, cache_write: 0 } },
      { provider: 'anthropic', model: 'claude-opus-4-6', name: 'Claude Opus 4.6', cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } },
      { provider: 'google', model: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', cost: { input: 0.75, output: 3.75, cache_read: 0.075, cache_write: 0 } }
    ];
  }

  const list = [];
  for (const [providerId, provider] of Object.entries(raw)) {
    for (const [modelId, model] of Object.entries(provider.models || {})) {
      if (model.cost) {
        list.push({
          provider: providerId,
          model: modelId,
          name: model.name || modelId,
          cost: {
            input: model.cost.input ?? 0,
            output: model.cost.output ?? 0,
            cache_read: model.cost.cache_read ?? model.cost.cache?.read ?? 0,
            cache_write: model.cost.cache_write ?? model.cost.cache?.write ?? 0
          }
        });
      }
    }
  }
  return list;
}

function cleanModelName(str) {
  return str.toLowerCase()
    .replace(/^[a-z0-9_-]+\//, '')
    .replace(/-tiered$/, '')
    .replace(/-sg$/, '')
    .replace(/-preview.*$/, '')
    .replace(/-thinking$/, '')
    .replace(/-agent$/, '')
    .replace(/-max$/, '')
    .replace(/-flashx/, '-flash')
    .replace(/v4\.1/, 'v4')
    .replace(/v4p1/, 'v4')
    .replace(/_1_6$/, '-1.6')
    .replace(/-code$/, '')
    .replace(/_advisor_doubao$/, '')
    .replace(/-free$/, '')
    .replace(/-disabled$/, '')
    .replace(/-1$/, '');
}

/**
 * Classify provider kind: 'subscription' (OAuth, Plan, Credits, Free) vs 'api' (Paid Key / Pay-as-you-go)
 */
function getProviderClassifications() {
  if (!fs.existsSync(PROVIDERS_STATE_PATH)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(PROVIDERS_STATE_PATH, 'utf8'));
    const list = data.providers?.providers || [];
    const kinds = {};
    for (const p of list) {
      const isSub = !!p.account || p.id.includes('free') || p.id.includes('plan');
      kinds[p.id] = {
        name: p.name || p.id,
        isSubscription: isSub,
        kind: isSub ? 'subscription' : 'api',
        planName: p.account?.plan || (p.key?.set ? 'API Key' : 'Account')
      };
    }
    return kinds;
  } catch {
    return {};
  }
}

function getMagpieModels() {
  if (!fs.existsSync(PROVIDERS_STATE_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(PROVIDERS_STATE_PATH, 'utf8'));
  const providersList = data.providers?.providers || [];
  const classifications = getProviderClassifications();
  const models = [];

  for (const p of providersList) {
    const providerId = p.id;
    const pInfo = classifications[providerId] || { kind: 'api', name: providerId };
    const pModels = p.models || [];
    for (const m of pModels) {
      models.push({
        provider: providerId,
        providerName: pInfo.name,
        providerKind: pInfo.kind,
        id: m.id,
        fullName: providerId + '/' + m.id,
        name: m.name || m.id,
        free: !!m.free,
        listPrice: m.list || null
      });
    }
  }
  return models;
}

function getCustomPrices() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return s.modelPrices || {};
  } catch {
    return {};
  }
}

function getPricingStatus(models) {
  const customPrices = getCustomPrices();
  const result = [];

  for (const m of models) {
    const custom = customPrices[m.fullName] || customPrices['*/' + m.id];
    const isUnpriced = !m.free && !m.listPrice && !custom;

    let priceInfo = 'no price is known for it';
    if (m.free) {
      priceInfo = 'Free model ($0.00)';
    } else if (custom) {
      priceInfo = `Custom: $${custom.input}/$${custom.output} in/out (cache: $${custom.cache_read}/$${custom.cache_write})`;
    } else if (m.listPrice) {
      priceInfo = `List: $${m.listPrice.input}/$${m.listPrice.output} in/out`;
    }

    result.push({
      model: m.fullName,
      modelObj: m,
      isUnpriced,
      priceInfo
    });
  }
  return result;
}

function isOfficialMaker(providerId, hints = []) {
  const p = providerId.toLowerCase();
  if (hints.length > 0) {
    return hints.some(h => p === h || p.startsWith(h + '-') || p.endsWith('-' + h) || p.includes(h));
  }
  return OFFICIAL_MAKERS.some(m => p === m || p.startsWith(m + '-') || p.endsWith('-' + m));
}

function matchModel(target, catalog) {
  const bare = (target.includes('/') ? target.split('/')[1] : target).toLowerCase();
  const cleaned = cleanModelName(target);
  const hints = getVendorHints(target);

  const exactCandidates = catalog.filter(c => c.model.toLowerCase() === bare);
  const cleanedCandidates = catalog.filter(c => cleanModelName(c.model) === cleaned);
  const fuzzyCandidates = catalog.filter(c => {
    const cClean = cleanModelName(c.model);
    return c.model.toLowerCase().includes(cleaned) || cleaned.includes(cClean);
  });

  function pickBest(list) {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => {
      const aHint = hints.some(h => a.provider.toLowerCase().includes(h)) ? 1 : 0;
      const bHint = hints.some(h => b.provider.toLowerCase().includes(h)) ? 1 : 0;
      if (aHint !== bHint) return bHint - aHint;

      const aOff = isOfficialMaker(a.provider) ? 1 : 0;
      const bOff = isOfficialMaker(b.provider) ? 1 : 0;
      if (aOff !== bOff) return bOff - aOff;

      const aNonZero = (a.cost.input > 0 || a.cost.output > 0) ? 1 : 0;
      const bNonZero = (b.cost.input > 0 || b.cost.output > 0) ? 1 : 0;
      return bNonZero - aNonZero;
    });
    return sorted[0];
  }

  const hintCleaned = cleanedCandidates.filter(c => hints.some(h => c.provider.toLowerCase().includes(h)));
  if (hintCleaned.length > 0) {
    const best = pickBest(hintCleaned);
    return { match: best, confidence: 'exact', reason: '原厂规约匹配 (' + best.provider + ')' };
  }

  const exactHit = pickBest(exactCandidates);
  if (exactHit) {
    return { match: exactHit, confidence: 'exact', reason: isOfficialMaker(exactHit.provider) ? '官方原厂精准匹配' : '渠道精准匹配 (' + exactHit.provider + ')' };
  }

  const cleanedHit = pickBest(cleanedCandidates);
  if (cleanedHit) {
    return { match: cleanedHit, confidence: 'high', reason: isOfficialMaker(cleanedHit.provider) ? '官方规格匹配' : '渠道规格匹配 (' + cleanedHit.provider + ')' };
  }

  const hintFuzzy = fuzzyCandidates.filter(c => hints.some(h => c.provider.toLowerCase().includes(h)));
  if (hintFuzzy.length > 0) {
    const best = pickBest(hintFuzzy);
    return { match: best, confidence: 'medium', reason: '关联厂商模型 (' + best.provider + ')' };
  }

  const fuzzyHit = pickBest(fuzzyCandidates);
  if (fuzzyHit) {
    return { match: fuzzyHit, confidence: 'medium', reason: '模糊推荐匹配 (' + fuzzyHit.provider + ')' };
  }

  return null;
}

function scanAll() {
  const catalog = loadCatalog();
  const allModels = getMagpieModels();
  const statuses = getPricingStatus(allModels);

  const report = [];
  for (const s of statuses) {
    const matchResult = matchModel(s.model, catalog);
    const preset = hasOffPeakPreset(s.model, s.modelObj.provider);
    report.push({
      model: s.model,
      name: s.modelObj.name,
      provider: s.modelObj.provider,
      providerName: s.modelObj.providerName,
      providerKind: s.modelObj.providerKind,
      isUnpriced: s.isUnpriced,
      currentPrice: s.priceInfo,
      offPeakPreset: preset,
      matched: matchResult ? {
        provider: matchResult.match.provider,
        model: matchResult.match.model,
        name: matchResult.match.name,
        confidence: matchResult.confidence,
        reason: matchResult.reason,
        cost: matchResult.match.cost,
        priceString: [
          matchResult.match.cost.input,
          matchResult.match.cost.output,
          matchResult.match.cost.cache_read,
          matchResult.match.cost.cache_write
        ].join(',')
      } : null
    });
  }
  return report;
}

function applyPrice(model, priceString) {
  const parts = priceString.split(',').map(p => parseFloat(p.trim()) || 0);
  const priceObj = {
    input: parts[0] ?? 0,
    output: parts[1] ?? 0,
    cache_read: parts[2] ?? 0,
    cache_write: parts[3] ?? 0
  };

  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  s.modelPrices = s.modelPrices || {};
  s.modelPrices[model] = priceObj;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');

  return `Applied ${model} -> $${priceObj.input}/$${priceObj.output}`;
}

function resetPrice(model) {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  if (s.modelPrices && s.modelPrices[model]) {
    delete s.modelPrices[model];
    if (Object.keys(s.modelPrices).length === 0) {
      delete s.modelPrices;
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
    return `Reset price for ${model}`;
  }
  return `No custom price found for ${model}`;
}

/**
 * Apply Global Pricing Mode:
 * - 'api-only': only write real prices for 'api' providers; subscription providers have prices set to 0 or removed
 * - 'all-equivalent': write market prices for all models
 */
function applyGlobalMode(mode, customOverrides = {}) {
  const report = scanAll();
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const newPrices = {};

  if (mode === 'api-only') {
    // Only apply prices for paid API providers or explicit custom overrides
    for (const item of report) {
      if (item.providerKind === 'api') {
        if (customOverrides[item.model]) {
          newPrices[item.model] = customOverrides[item.model];
        } else if (item.matched) {
          newPrices[item.model] = {
            input: item.matched.cost.input,
            output: item.matched.cost.output,
            cache_read: item.matched.cost.cache_read,
            cache_write: item.matched.cost.cache_write
          };
        }
      } else {
        // Subscription / free accounts: explicit zero so Magpie doesn't bill them
        newPrices[item.model] = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
      }
    }
  } else {
    // all-equivalent: all providers get their market value
    for (const item of report) {
      if (customOverrides[item.model]) {
        newPrices[item.model] = customOverrides[item.model];
      } else if (item.matched) {
        newPrices[item.model] = {
          input: item.matched.cost.input,
          output: item.matched.cost.output,
          cache_read: item.matched.cost.cache_read,
          cache_write: item.matched.cost.cache_write
        };
      }
    }
  }

  // Include any wildcard overrides
  for (const [k, v] of Object.entries(customOverrides)) {
    if (k.startsWith('*/') && v) {
      newPrices[k] = v;
    }
  }

  s.modelPrices = newPrices;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf8');
  return Object.keys(newPrices).length;
}

/**
 * Peak & Off-Peak (分时峰谷) calculation helpers
 */
function getBeijingTime(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * 8);
}

function checkOffPeakStatus(date = new Date(), rule = 'deepseek') {
  const bj = getBeijingTime(date);
  const day = bj.getDay(); // 0 is Sun, 6 is Sat
  const hour = bj.getHours();
  const min = bj.getMinutes();
  const t = hour + min / 60;

  if (rule === 'night_22_08') {
    const isOff = t >= 22 || t < 8;
    return {
      isOffPeak: isOff,
      rule,
      discount: isOff ? 0.5 : 1.0,
      hour,
      min,
      day,
      label: isOff ? '夜间闲时 (22:00-08:00)' : '白天正常'
    };
  }

  // DeepSeek official rule:
  // Weekend: all day off-peak (50% discount)
  if (day === 0 || day === 6) {
    return {
      isOffPeak: true,
      rule: 'deepseek',
      reason: 'weekend',
      discount: 0.5,
      hour,
      min,
      day,
      label: '周末全天闲时 (5折)'
    };
  }

  // Workdays:
  // Peak: 09:00 - 12:00, 14:00 - 18:00
  // Off-peak: 00:00 - 09:00, 12:00 - 14:00, 18:00 - 24:00
  const isPeak = (t >= 9 && t < 12) || (t >= 14 && t < 18);
  return {
    isOffPeak: !isPeak,
    rule: 'deepseek',
    reason: isPeak ? 'workday_peak' : (t >= 12 && t < 14 ? 'lunch_offpeak' : 'night_offpeak'),
    discount: !isPeak ? 0.5 : 1.0,
    hour,
    min,
    day,
    label: isPeak ? '工作日高峰时段' : '闲时低谷时段 (5折)'
  };
}

function hasOffPeakPreset(modelName = '', provider = '') {
  const m = (modelName || '').toLowerCase();
  const p = (provider || '').toLowerCase();
  if (m.includes('deepseek') || p.includes('deepseek')) {
    return {
      supported: true,
      provider: 'deepseek',
      rule: 'deepseek',
      discount: 0.5,
      name: 'DeepSeek 官方峰谷 (闲时5折)'
    };
  }
  if (m.includes('qwen') || p.includes('alibaba') || p.includes('bailian')) {
    return {
      supported: true,
      provider: 'alibaba',
      rule: 'deepseek',
      discount: 0.5,
      name: '百炼/千问 闲时策略'
    };
  }
  return {
    supported: false
  };
}

module.exports = {
  loadCatalog,
  getMagpieModels,
  getPricingStatus,
  getProviderClassifications,
  matchModel,
  scanAll,
  applyPrice,
  resetPrice,
  applyGlobalMode,
  getBeijingTime,
  checkOffPeakStatus,
  hasOffPeakPreset
};
