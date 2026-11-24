// matcher.js - Core logic for matching Magpie models with models.dev data & pricing modes
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const CACHE_MODELS_PATH = path.join(HOME, '.cache/magpie/models.json');
const PROVIDERS_STATE_PATH = path.join(HOME, '.cache/magpie/providers-state.json');
const PROVIDERS_CONFIG_PATH = path.join(HOME, '.config/magpie/providers.json');
const SETTINGS_PATH = path.join(HOME, '.config/magpie/settings.json');
const USAGE_PATH = path.join(HOME, '.config/magpie/usage.jsonl');

// Preferred official makers in models.dev
const OFFICIAL_MAKERS = [
  'deepseek', 'google', 'anthropic', 'openai', 'zhipu', 'zhipuai',
  'moonshot', 'moonshotai', 'bytedance', 'volcengine', 'baichuan',
  'minimax', 'stepfun', 'xiaomi', 'tencent', 'qwen', 'alibaba'
];

function getVendorHints(target) {
  const t = target.toLowerCase();
  const hints = [];
  if (t.includes('qwen') || t.startsWith('qwenwork/') || t.includes('blian')) hints.push('qwen', 'alibaba', 'bailian');
  if (t.includes('deepseek')) hints.push('deepseek');
  if (t.includes('gemini') || t.startsWith('gemini/')) hints.push('google');
  if (t.includes('claude')) hints.push('anthropic');
  if (t.includes('gpt-') || t.includes('codex/')) hints.push('openai');
  if (t.includes('kimi')) hints.push('moonshot', 'moonshotai');
  if (t.includes('glm')) hints.push('zhipu', 'zhipuai', 'glm', 'bigmodel');
  if (t.includes('doubao') || t.includes('seed-') || t.includes('huoshan')) hints.push('volcengine', 'bytedance', 'doubao');
  if (t.includes('minimax')) hints.push('minimax');
  if (t.includes('mimo')) hints.push('xiaomi');
  if (t.includes('hy3') || t.includes('hy4') || t.includes('hunyuan')) hints.push('tencent');
  if (t.includes('step-')) hints.push('stepfun');
  return hints;
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
  let s = str.toLowerCase()
    .replace(/^[a-z0-9_-]+\//, '')
    .replace(/^(blian_|huoshan_|vlm_huoshan_)/, '')
    .replace(/(-\d{6,8}|-\d{4}-\d{2}-\d{2})$/, '')
    .replace(/-ga(-\d+)?$/, '')
    .replace(/-tiered$/, '')
    .replace(/-control$/, '')
    .replace(/-n$/, '')
    .replace(/-sg$/, '')
    .replace(/-preview.*$/, '')
    .replace(/-thinking$/, '')
    .replace(/-agent$/, '')
    .replace(/-flashx/, '-flash')
    .replace(/-code$/, '')
    .replace(/_advisor_doubao$/, '')
    .replace(/-free$/, '')
    .replace(/-disabled$/, '')
    .replace(/-1$/, '')
    .replace(/_/g, '-');

  s = s.replace(/qwen(\d)(\d)/, (_, a, b) => 'qwen' + a + '.' + b);
  s = s.replace(/glm-(\d)-(\d)/, (_, a, b) => 'glm-' + a + '.' + b);
  s = s.replace(/v4[.-]1/, 'v4');
  s = s.replace(/v4p1/, 'v4');
  s = s.replace(/doubao[_-]1[_-]6/i, 'doubao-seed-1.6');

  if (s.includes('2-0-lite') || s.includes('2.0-lite')) return 'doubao-seed-2.0-lite';
  if (s.includes('2-0-mini') || s.includes('2.0-mini')) return 'doubao-seed-2.0-mini';
  if (s.includes('hy-vision') || s.includes('hunyuan-vision')) return 'hunyuan-2.0-instruct';
  if (s === 'hy4' || s === 'hy4-preview' || s === 'hy4-free') return 'hunyuan-2.0-instruct';

  return s;
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
        icon: p.icon || null,
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

/**
 * Retrieve routing group IDs configured in Magpie providers.json
 */
function getRoutingGroupIds() {
  const groupIds = new Set(['never-stuck', 'free']);
  if (fs.existsSync(PROVIDERS_CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROVIDERS_CONFIG_PATH, 'utf8'));
      const groups = data.groups || [];
      for (const g of groups) {
        if (g && g.id) groupIds.add(g.id);
      }
    } catch {}
  }
  return groupIds;
}

/**
 * Detect whether a request log entry in usage.jsonl is a test probe, health check or internal tool call
 */
function isTestOrProbeRequest(r) {
  if (!r || typeof r !== 'object') return true;
  if (!r.provider || r.provider === 'unknown') return true;
  if (r.operation === 'execute_tool') return true;
  if (r.source === 'probe' || r.source === 'tool') return true;
  if (
    r.kind === 'tool' ||
    r.kind === 'mcp' ||
    r.kind === 'provider_test' ||
    r.kind === 'model_list' ||
    r.kind === 'connection_check' ||
    r.kind === 'api_detect'
  ) return true;
  if (typeof r.kind === 'string' && r.kind.toLowerCase().includes('test')) return true;
  if (typeof r.operation === 'string' && r.operation.toLowerCase().includes('test')) return true;

  // Test agents: internal Magpie probe daemon, curl manual connectivity checks, or headless probe clients
  if (r.agent === 'magpie' || r.agent === 'curl') return true;

  // Failed, cancelled, or error requests (e.g. 400, 404, 499, 500)
  if (r.status && Number(r.status) !== 200) return true;

  // Zero-token exchanges (dummy pings or probes that didn't run inference)
  const inT = r.in || 0;
  const outT = r.out || 0;
  if (inT === 0 && outT === 0) return true;

  // Automated batch connection probes from scripts (e.g. node test ping with trivial token payloads)
  if (r.agent === 'node' && outT <= 15 && inT <= 60) return true;

  return false;
}

function getMagpieModels() {
  const models = [];
  const seen = new Set();
  const providerDeclaredModels = new Set();
  const classifications = getProviderClassifications();
  const routingGroupIds = getRoutingGroupIds();

  if (fs.existsSync(PROVIDERS_STATE_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROVIDERS_STATE_PATH, 'utf8'));
      const providersList = data.providers?.providers || [];

      for (const p of providersList) {
        const providerId = p.id;
        const isProviderOn = !p.off;
        const pInfo = classifications[providerId] || { kind: 'api', name: providerId };
        const pModels = p.models || [];
        for (const m of pModels) {
          if (!m.id || m.id.startsWith('group/') || m.id === 'never-stuck') continue;
          const isModelOn = m.on !== false;
          const isEnabled = isProviderOn && isModelOn;
          const fullName = providerId + '/' + m.id;
          seen.add(fullName);
          providerDeclaredModels.add(fullName);
          models.push({
            provider: providerId,
            providerName: pInfo.name,
            providerIcon: p.icon || pInfo.icon || null,
            providerKind: pInfo.kind,
            id: m.id,
            fullName: fullName,
            name: m.name || m.id,
            free: !!m.free,
            listPrice: m.list || null,
            enabled: isEnabled,
            providerOff: !!p.off,
            modelOn: isModelOn
          });
        }
      }
    } catch {}
  }

  // Also include models observed in usage.jsonl or recent sessions/calls (excluding routing groups)
  if (fs.existsSync(USAGE_PATH)) {
    try {
      const content = fs.readFileSync(USAGE_PATH, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (isTestOrProbeRequest(r)) continue;
          const prov = r.provider;
          const isGroupReq = r.req && (r.req.startsWith('group/') || r.req.startsWith('group:'));
          const candidates = [
            r.model,
            r.served,
            (!isGroupReq && r.req) ? (r.req.includes('/') ? r.req.split('/')[1] : r.req) : null
          ];
          for (const mId of candidates) {
            if (
              !mId ||
              mId === 'probe' ||
              mId === 'unknown' ||
              mId === 'auto' ||
              mId.startsWith('group/') ||
              mId === 'never-stuck' ||
              mId.includes('__') ||
              mId.includes('search') ||
              mId === 'find_tools' ||
              mId === 'Tavily' ||
              mId === 'web_fetch' ||
              mId.endsWith('-model')
            ) {
              continue;
            }
            const full = prov + '/' + mId;
            // Exclude routing group names that are not actually declared provider models
            if (routingGroupIds.has(mId) && !providerDeclaredModels.has(full)) {
              continue;
            }
            if (!seen.has(full)) {
              seen.add(full);
              const pInfo = classifications[prov] || { kind: 'subscription', name: prov };
              models.push({
                provider: prov,
                providerName: pInfo.name,
                providerIcon: pInfo.icon || null,
                providerKind: pInfo.kind,
                id: mId,
                fullName: full,
                name: mId,
                free: false,
                listPrice: null,
                enabled: true,
                providerOff: false,
                modelOn: true
              });
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Always ensure known Antigravity & popular variants are registered
  const extraVariants = [
    { prov: 'antigravity', id: 'gemini-3.8-flash-control' },
    { prov: 'antigravity', id: 'gemini-3.8-flash-tiered' },
    { prov: 'antigravity', id: 'gemini-3.8-flash-n' }
  ];
  for (const item of extraVariants) {
    const full = item.prov + '/' + item.id;
    if (!seen.has(full)) {
      seen.add(full);
      const pInfo = classifications[item.prov] || { kind: 'subscription', name: item.prov };
      models.push({
        provider: item.prov,
        providerName: pInfo.name,
        providerIcon: pInfo.icon || null,
        providerKind: pInfo.kind,
        id: item.id,
        fullName: full,
        name: item.id,
        free: false,
        listPrice: null,
        enabled: true,
        providerOff: false,
        modelOn: true
      });
    }
  }

  return models;
}

function getUsageData() {
  const channelUsage = {};
  const bareUsage = {};
  const totalSummary = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    totalTokens: 0
  };

  if (!fs.existsSync(USAGE_PATH)) {
    return { channelUsage, bareUsage, totalSummary };
  }

  try {
    const content = fs.readFileSync(USAGE_PATH, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        // 严格排除测试请求与健康探针 (Magpie 自身健康探针、curl 手动测试、0 Token 请求、错误状态等)
        if (isTestOrProbeRequest(r)) continue;

        const isGroupReq = r.req && (r.req.startsWith('group/') || r.req.startsWith('group:'));
        const actualModel = (r.served && r.served !== 'auto') ? r.served : (r.model !== 'auto' ? r.model : null);
        const bare = actualModel || (!isGroupReq && r.req ? (r.req.includes('/') ? r.req.split('/')[1] : r.req) : null);
        if (
          !bare ||
          bare === 'unknown' ||
          bare === 'probe' ||
          bare === 'auto' ||
          bare === 'find_tools' ||
          bare === 'Tavily' ||
          bare === 'web_fetch' ||
          bare === 'never-stuck' ||
          bare.startsWith('group/') ||
          bare.endsWith('-model')
        ) {
          continue;
        }
        const req = (!isGroupReq && r.req && r.req.includes('/') && !r.req.startsWith('group/'))
          ? r.req
          : (r.provider + '/' + bare);
        const inT = r.in || 0;
        const outT = r.out || 0;
        const cRead = r.cache_read || 0;
        const cWrite = r.cache_write || 0;
        const sumT = inT + outT;

        totalSummary.requests++;
        totalSummary.inputTokens += inT;
        totalSummary.outputTokens += outT;
        totalSummary.cacheRead += cRead;
        totalSummary.totalTokens += sumT;

        if (!channelUsage[req]) {
          channelUsage[req] = {
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            lastAt: r.t
          };
        }
        channelUsage[req].requests++;
        channelUsage[req].inputTokens += inT;
        channelUsage[req].outputTokens += outT;
        channelUsage[req].cacheRead += cRead;
        channelUsage[req].cacheWrite += cWrite;
        channelUsage[req].totalTokens += sumT;
        if (r.t && (!channelUsage[req].lastAt || r.t > channelUsage[req].lastAt)) {
          channelUsage[req].lastAt = r.t;
        }

        const updateBare = (bKey) => {
          if (!bareUsage[bKey]) {
            bareUsage[bKey] = {
              requests: 0,
              inputTokens: 0,
              outputTokens: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              lastAt: r.t
            };
          }
          bareUsage[bKey].requests++;
          bareUsage[bKey].inputTokens += inT;
          bareUsage[bKey].outputTokens += outT;
          bareUsage[bKey].cacheRead += cRead;
          bareUsage[bKey].cacheWrite += cWrite;
          bareUsage[bKey].totalTokens += sumT;
          if (r.t && (!bareUsage[bKey].lastAt || r.t > bareUsage[bKey].lastAt)) {
            bareUsage[bKey].lastAt = r.t;
          }
        };

        updateBare(bare);
        const cleaned = cleanModelName(bare);
        if (cleaned && cleaned !== bare) {
          updateBare(cleaned);
        }
      } catch {}
    }
  } catch (e) {
    console.warn('Failed to read usage.jsonl:', e.message);
  }

  return { channelUsage, bareUsage, totalSummary };
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
      // 0. Exact provider name match for vendor hint (e.g. 'google' === 'google' over 'google-vertex')
      const aExactProv = hints.some(h => a.provider.toLowerCase() === h) ? 1 : 0;
      const bExactProv = hints.some(h => b.provider.toLowerCase() === h) ? 1 : 0;
      if (aExactProv !== bExactProv) return bExactProv - aExactProv;

      // 1. Direct provider match for vendor hint (e.g. provider 'deepseek' for 'deepseek')
      const aProvHint = hints.some(h => a.provider.toLowerCase().includes(h) || h.includes(a.provider.toLowerCase())) ? 1 : 0;
      const bProvHint = hints.some(h => b.provider.toLowerCase().includes(h) || h.includes(b.provider.toLowerCase())) ? 1 : 0;
      if (aProvHint !== bProvHint) return bProvHint - aProvHint;

      // 2. Official maker preference
      const aOff = isOfficialMaker(a.provider) ? 1 : 0;
      const bOff = isOfficialMaker(b.provider) ? 1 : 0;
      if (aOff !== bOff) return bOff - aOff;

      // 3. Model name match for vendor hint
      const aModelHint = hints.some(h => a.model.toLowerCase().includes(h)) ? 1 : 0;
      const bModelHint = hints.some(h => b.model.toLowerCase().includes(h)) ? 1 : 0;
      if (aModelHint !== bModelHint) return bModelHint - aModelHint;

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
  const { channelUsage, bareUsage, totalSummary } = getUsageData();

  const report = [];
  for (const s of statuses) {
    const matchResult = matchModel(s.model, catalog);
    const preset = hasOffPeakPreset(s.model, s.modelObj.provider);
    const bare = s.modelObj.id || (s.model.includes('/') ? s.model.split('/')[1] : s.model);
    const chUsage = channelUsage[s.model] || null;
    const bUsage = bareUsage[bare] || null;

    report.push({
      model: s.model,
      name: s.modelObj.name,
      provider: s.modelObj.provider,
      providerName: s.modelObj.providerName,
      providerIcon: s.modelObj.providerIcon || null,
      providerKind: s.modelObj.providerKind,
      enabled: s.modelObj.enabled !== false,
      isUnpriced: s.isUnpriced,
      currentPrice: s.priceInfo,
      offPeakPreset: preset,
      usage: chUsage,
      bareUsage: bUsage,
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

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

// settings.json is Magpie's own file. Rewriting it when nothing changed costs
// a full re-serialisation each time and races with Magpie's own writes, so
// only touch it when modelPrices really differ, and replace it atomically.
function writeModelPricesIfChanged(s, newPrices) {
  const before = s.modelPrices && Object.keys(s.modelPrices).length ? s.modelPrices : undefined;
  const after = newPrices && Object.keys(newPrices).length ? newPrices : undefined;
  if (stableStringify(before) === stableStringify(after)) return false;
  if (after) s.modelPrices = after;
  else delete s.modelPrices;
  const tmp = SETTINGS_PATH + '.models-price.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_PATH);
  return true;
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
  writeModelPricesIfChanged(s, { ...(s.modelPrices || {}), [model]: priceObj });

  return `Applied ${model} -> $${priceObj.input}/$${priceObj.output}`;
}

function resetPrice(model) {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  if (s.modelPrices && s.modelPrices[model]) {
    const rest = { ...s.modelPrices };
    delete rest[model];
    writeModelPricesIfChanged(s, rest);
    return `Reset price for ${model}`;
  }
  return `No custom price found for ${model}`;
}

/**
 * Apply Global Pricing Mode:
 * - 'api-only': only write real prices for 'api' providers; subscription providers have prices set to 0 or removed
 * - 'all-equivalent': write market prices for all models
 * Returns { count, changed }; settings.json is left untouched when nothing changed.
 */
function applyGlobalModeIfChanged(mode, customOverrides = {}) {
  const report = scanAll();
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const newPrices = { ...(s.modelPrices || {}) };

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

  // Add wildcard fallbacks for bare model names and cleaned names so any un-prefixed request matches
  for (const item of report) {
    if (newPrices[item.model]) {
      const bare = item.model.includes('/') ? item.model.split('/')[1] : item.model;
      if (!newPrices['*/' + bare]) {
        newPrices['*/' + bare] = newPrices[item.model];
      }
      const cleaned = cleanModelName(bare);
      if (cleaned && !newPrices['*/' + cleaned]) {
        newPrices['*/' + cleaned] = newPrices[item.model];
      }
      // Explicitly map common model suffix variants
      if (cleaned === 'gemini-3.8-flash') {
        const variants = ['control', 'tiered', 'n'];
        for (const v of variants) {
          const vName = `gemini-3.8-flash-${v}`;
          if (!newPrices['*/' + vName]) newPrices['*/' + vName] = newPrices[item.model];
          if (item.model.includes('/')) {
            const p = item.model.split('/')[0];
            if (!newPrices[`${p}/${vName}`]) newPrices[`${p}/${vName}`] = newPrices[item.model];
          }
        }
      }
    }
  }

  // Universal alias fallback for any observed channel/variant whose cleaned name has a price
  const allKnownModels = getMagpieModels();
  for (const m of allKnownModels) {
    const full = m.fullName;
    const bare = m.id;
    const cleaned = cleanModelName(bare);
    if (!newPrices[full]) {
      const basePrice = newPrices['*/' + cleaned] || newPrices[m.provider + '/' + cleaned];
      if (basePrice) {
        newPrices[full] = basePrice;
        if (!newPrices['*/' + bare]) {
          newPrices['*/' + bare] = basePrice;
        }
      }
    }
  }

  // Remove any unknown/ invalid keys or routing groups
  for (const k of Object.keys(newPrices)) {
    if (
      k.startsWith('unknown/') ||
      k === '*/unknown' ||
      k.includes('/unknown') ||
      k.includes('never-stuck') ||
      k.startsWith('group/') ||
      k.includes('/group/') ||
      k === '*/free'
    ) {
      delete newPrices[k];
    }
  }

  const changed = writeModelPricesIfChanged(s, newPrices);
  return { count: Object.keys(newPrices).length, changed };
}

function applyGlobalMode(mode, customOverrides = {}) {
  return applyGlobalModeIfChanged(mode, customOverrides).count;
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
  cleanModelName,
  getMagpieModels,
  getPricingStatus,
  getProviderClassifications,
  getUsageData,
  matchModel,
  scanAll,
  applyPrice,
  resetPrice,
  applyGlobalMode,
  applyGlobalModeIfChanged,
  stableStringify,
  getBeijingTime,
  checkOffPeakStatus,
  hasOffPeakPreset
};
