// my-models.js - Data layer for the "My Models" pricing view.
//
// It only reads data Magpie and the plugin already have:
//   - the configured providers from magpie.read("providers:list") (id + name)
//   - the plugin's generated model snapshot (page/models-data.js)
//   - the plugin's own options (custom prices, billing mode, favorites)
//
// Magpie's page bridge does not expose a per-model "enabled" flag, so the view
// uses the models in the provider state snapshot and says so in its footnote.
// It never invents a price: an unknown price stays unknown, and a models.dev
// reference that the user has not applied is marked as a reference only.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MagpieMyModels = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SOURCE = {
    CUSTOM: "custom",
    WILDCARD: "wildcard",
    LIST: "list",
    FREE: "free",
    ZERO: "subscription-zero",
    REFERENCE: "reference",
    UNKNOWN: "unknown"
  };

  const SOURCE_LABEL = {
    custom: "自定义 · 渠道",
    wildcard: "自定义 · 通配",
    list: "渠道价",
    free: "免费",
    "subscription-zero": "订阅 · 免计费",
    reference: "官方参考（未应用）",
    unknown: "未知"
  };

  const SOURCE_ORDER = {
    custom: 0,
    wildcard: 1,
    list: 2,
    "subscription-zero": 3,
    free: 4,
    reference: 5,
    unknown: 6
  };

  function bareModel(fullName) {
    const s = String(fullName || "");
    return s.includes("/") ? s.slice(s.indexOf("/") + 1) : s;
  }

  function providerOf(fullName) {
    const s = String(fullName || "");
    return s.includes("/") ? s.slice(0, s.indexOf("/")) : "";
  }

  function num(value) {
    const n = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  // currentPrice is the string scanAll() writes into models-data.js:
  //   "List: $0.75/$3.75 in/out"
  //   "Custom: $1/$5 in/out (cache: $0.5/$0)"
  //   "Free model ($0.00)"
  //   "no price is known for it"
  // Parsing keeps old snapshots usable; structured fields win when present.
  function parseCurrentPrice(text) {
    const s = String(text || "");
    const list = s.match(/^List:\s*\$([\d.]+)\s*\/\s*\$([\d.]+)/i);
    if (list) {
      return {
        source: SOURCE.LIST,
        input: num(list[1]),
        output: num(list[2]),
        cache_read: null,
        cache_write: null
      };
    }
    const custom = s.match(/^Custom:\s*\$([\d.]+)\s*\/\s*\$([\d.]+)\s+in\/out\s*\(cache:\s*\$([\d.]+)\s*\/\s*\$([\d.]+)\)/i);
    if (custom) {
      return {
        source: SOURCE.CUSTOM,
        input: num(custom[1]),
        output: num(custom[2]),
        cache_read: num(custom[3]),
        cache_write: num(custom[4])
      };
    }
    if (/^Free model/i.test(s)) {
      return {
        source: SOURCE.FREE,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0
      };
    }
    return null;
  }

  function customPriceFor(fullName, customPrices) {
    const prices = customPrices || {};
    const specific = prices[fullName];
    if (specific) return { price: specific, source: SOURCE.CUSTOM };
    const wildcard = prices["*/" + bareModel(fullName)];
    if (wildcard) return { price: wildcard, source: SOURCE.WILDCARD };
    return null;
  }

  function normalizePrice(price, source) {
    return {
      source,
      input: num(price.input),
      output: num(price.output),
      cache_read: num(price.cache_read != null ? price.cache_read : price.cacheRead),
      cache_write: num(price.cache_write != null ? price.cache_write : price.cacheWrite)
    };
  }

  /**
   * Resolve the price the user's Magpie instance would actually bill, plus
   * the models.dev reference when the two differ.
   *
   * Order (same as the original plugin):
   *   1. plugin option for "<provider>/<model>"
   *   2. plugin option for the any-provider key, "<model>" under "*"
   *   3. api-only mode: a subscription provider is explicitly $0
   *   4. the applied price in Magpie settings (currentPrice)
   *   5. otherwise the models.dev match is a reference, not an applied price
   */
  function resolvePrice(item, customPrices, mode) {
    try {
      const custom = customPriceFor(item.model, customPrices);
      if (custom) {
        const p = normalizePrice(custom.price, custom.source);
        return { price: p, applied: true, reference: referenceOf(item) };
      }

      if (mode === "api-only" && item.providerKind === "subscription") {
        return {
          price: { source: SOURCE.ZERO, input: 0, output: 0, cache_read: 0, cache_write: 0 },
          applied: true,
          reference: referenceOf(item)
        };
      }

      const parsed = parseCurrentPrice(item.currentPrice);
      if (parsed) {
        const source = parsed.source === SOURCE.CUSTOM ? SOURCE.CUSTOM : parsed.source;
        return {
          price: normalizedOrNull(parsed, source),
          applied: true,
          reference: referenceOf(item)
        };
      }

      const ref = referenceOf(item);
      if (ref) {
        return {
          price: normalizedOrNull(ref, SOURCE.REFERENCE),
          applied: false,
          reference: ref
        };
      }

      return { price: null, applied: false, reference: null };
    } catch (err) {
      return { price: null, applied: false, reference: null, error: String(err && err.message || err) };
    }
  }

  function normalizedOrNull(p, source) {
    if (!p) return null;
    const out = normalizePrice(p, source);
    if (out.input == null && out.output == null) return null;
    return out;
  }

  function referenceOf(item) {
    const cost = item && item.matched && item.matched.cost;
    if (!cost) return null;
    const ref = {
      input: num(cost.input),
      output: num(cost.output),
      cache_read: num(cost.cache_read),
      cache_write: num(cost.cache_write),
      provider: item.matched.provider,
      model: item.matched.model,
      confidence: item.matched.confidence
    };
    if (ref.input == null && ref.output == null) return null;
    return ref;
  }

  /**
   * Build the rows of the My Models view.
   * models: items from models-data.js
   * providers: [{id, name}] from providers:list, or null when unavailable
   */
  function buildRows(models, options) {
    const opts = options || {};
    const customPrices = opts.customPrices || {};
    const mode = opts.mode || "all-equivalent";
    const providers = Array.isArray(opts.providers) ? opts.providers : null;
    const byId = new Map();
    if (providers) for (const p of providers) byId.set(p.id, p.name || p.id);

    const rows = [];
    for (const item of models || []) {
      if (!item || !item.model) continue;
      const providerId = item.provider || providerOf(item.model);
      if (providers && !byId.has(providerId)) continue;
      const resolved = resolvePrice(item, customPrices, mode);
      rows.push({
        key: item.model,
        item,
        provider: providerId,
        providerName: (providers && byId.get(providerId)) || item.providerName || providerId,
        model: item.model,
        bare: bareModel(item.model),
        name: item.name || bareModel(item.model),
        providerKind: item.providerKind || "api",
        free: !!item.free,
        price: resolved.price,
        applied: resolved.applied,
        reference: resolved.reference,
        error: resolved.error || null
      });
    }
    return rows;
  }

  function hasPrice(row) {
    return !!(row && row.price && (row.price.input != null || row.price.output != null));
  }

  function matchesQuery(row, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return [row.model, row.bare, row.name, row.provider, row.providerName]
      .some((v) => String(v || "").toLowerCase().includes(q));
  }

  function filterRows(rows, filters) {
    const f = filters || {};
    const selected = Array.isArray(f.providers) ? new Set(f.providers) : null;
    return (rows || []).filter((row) => {
      if (selected && !selected.has(row.provider)) return false;
      if (f.onlyFavorites && !(f.favorites && f.favorites.has(row.key))) return false;
      if (f.hideUnpriced && !hasPrice(row)) return false;
      return matchesQuery(row, f.query);
    });
  }

  function numericValue(row, key) {
    if (!hasPrice(row)) return null;
    const v = row.price[key];
    return v == null ? null : v;
  }

  function sortRows(rows, sort) {
    const s = sort || { key: "provider", dir: "asc" };
    const dir = s.dir === "desc" ? -1 : 1;
    const list = [...(rows || [])];
    const cmpText = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
    const compare = (a, b) => {
      if (s.key === "input" || s.key === "output" || s.key === "cache_read") {
        const av = numericValue(a, s.key);
        const bv = numericValue(b, s.key);
        if (av == null && bv == null) return cmpText(a.model, b.model);
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return (av - bv) * dir;
        return cmpText(a.model, b.model);
      }
      if (s.key === "source") {
        const av = a.price ? (SOURCE_ORDER[a.price.source] ?? 99) : 99;
        const bv = b.price ? (SOURCE_ORDER[b.price.source] ?? 99) : 99;
        if (av !== bv) return (av - bv) * dir;
        return cmpText(a.model, b.model);
      }
      if (s.key === "model") {
        return cmpText(a.model, b.model) * dir || cmpText(a.providerName, b.providerName);
      }
      return cmpText(a.providerName, b.providerName) * dir ||
        cmpText(a.provider, b.provider) ||
        cmpText(a.model, b.model);
    };
    return list.sort(compare);
  }

  // Group only identical bare model ids. Aliases and cleaned names are never
  // merged here; a wrong merge is worse than a missed comparison.
  function groupByModel(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const key = row.bare.toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, bare: row.bare, rows: [] });
      groups.get(key).rows.push(row);
    }
    const list = [...groups.values()];
    for (const g of list) {
      g.rows.sort((a, b) => String(a.providerName).localeCompare(String(b.providerName)));
      g.providerCount = new Set(g.rows.map((r) => r.provider)).size;
      g.comparable = g.providerCount > 1;
    }
    return list.sort((a, b) => {
      if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
      return String(a.bare).localeCompare(String(b.bare));
    });
  }

  function reconcileProviders(configuredIds, saved) {
    const ids = [...new Set((configuredIds || []).filter(Boolean))];
    if (!Array.isArray(saved)) return ids;
    return saved.filter((id) => ids.includes(id));
  }

  function pruneFavorites(favorites, knownKeys) {
    const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys || []);
    const kept = [];
    const stale = [];
    for (const key of [...new Set(favorites || [])]) {
      if (known.has(key)) kept.push(key); else stale.push(key);
    }
    return { kept, stale };
  }

  function formatPrice(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    if (value === 0) return "$0";
    if (Math.abs(value) >= 1) {
      return "$" + (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
    }
    return "$" + value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function sourceLabel(row) {
    if (!row || !row.price) return SOURCE_LABEL.unknown;
    return SOURCE_LABEL[row.price.source] || SOURCE_LABEL.unknown;
  }

  return {
    SOURCE,
    SOURCE_LABEL,
    bareModel,
    providerOf,
    parseCurrentPrice,
    customPriceFor,
    resolvePrice,
    buildRows,
    hasPrice,
    filterRows,
    sortRows,
    groupByModel,
    reconcileProviders,
    pruneFavorites,
    formatPrice,
    sourceLabel,
    matchesQuery
  };
});
