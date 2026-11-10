// app.js - Model Prices Controller with Master Mode Switch, Scope, Time-of-Use Peak/Off-Peak Pricing & Full i18n
(async () => {
  const $ = (id) => document.getElementById(id);
  const { t, setLocale, onLocaleChange, getLocale } = window.I18N_MODULE || {
    t: (k) => k,
    setLocale: () => {},
    onLocaleChange: () => {},
    getLocale: () => "zh"
  };

  let toastTimer = null;
  function showToast(msg) {
    const tEl = $("toast");
    if (!tEl) return;
    tEl.textContent = msg;
    tEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      tEl.hidden = true;
    }, 2500);
  }

  // Load models data and options
  const rawModels = window.__MAGPIE_MODELS_DATA__ || [];
  let pluginOptions = {};
  let customPrices = {};
  let globalMode = "all-equivalent"; // "all-equivalent" or "api-only"
  let filter = "all";
  let search = "";
  let editingModel = null;
  let selectedScope = "specific";

  // 1. 初始化 Magpie 宿主通信规范 (Host PostMessage Handshake & Theme/Locale Sync)
  function initMagpieHostSync() {
    let callId = 1;
    const pendingCalls = new Map();

    window.addEventListener("message", (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object" || msg.magpie !== 1) return;

      if (msg.id && pendingCalls.has(msg.id)) {
        const { resolve, reject } = pendingCalls.get(msg.id);
        pendingCalls.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
        return;
      }

      if (msg.event === "theme" && msg.data) {
        applyHostTheme(msg.data);
      }
    });

    function callHost(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = "call-" + callId++;
        pendingCalls.set(id, { resolve, reject });
        window.parent.postMessage({ magpie: 1, id, method, params }, "*");
        setTimeout(() => {
          if (pendingCalls.has(id)) {
            pendingCalls.delete(id);
            reject(new Error("Host call timed out: " + method));
          }
        }, 3000);
      });
    }

    function applyHostTheme(data) {
      if (!data) return;
      const root = document.documentElement;
      if (data.dark !== undefined) {
        root.dataset.theme = data.dark ? "dark" : "light";
      }
      if (data.tokens) {
        for (const [k, v] of Object.entries(data.tokens)) {
          if (v) root.style.setProperty("--" + k, v);
        }
      }
      if (data.lang) {
        setLocale(data.lang);
      }
    }

    callHost("hello")
      .then((res) => {
        if (res) applyHostTheme(res);
      })
      .catch(() => {});
  }

  // 2. 初始化 Magpie bridge (如果存在)
  if (globalThis.magpie) {
    try {
      const theme = await magpie.ready;
      if (theme && theme.lang) {
        setLocale(theme.lang);
      }
      if (theme && theme.dark !== undefined) {
        document.documentElement.dataset.theme = theme.dark ? "dark" : "light";
      }
      magpie.onTheme?.((tTheme) => {
        if (tTheme.dark !== undefined) {
          document.documentElement.dataset.theme = tTheme.dark ? "dark" : "light";
        }
        if (tTheme.lang) {
          setLocale(tTheme.lang);
        }
      });
      pluginOptions = (await magpie.options.get()) || {};
      customPrices = pluginOptions.customPrices || {};
      globalMode = pluginOptions.mode || "all-equivalent";
    } catch (e) {
      console.warn("Magpie bridge ready warning:", e);
    }
  }

  initMagpieHostSync();

  function getBareModel(fullName) {
    return fullName.includes("/") ? fullName.split("/")[1] : fullName;
  }

  // 3. 峰谷分时时段计算 (Time-of-Use & DeepSeek Official Schedule)
  function getBeijingTime(date = new Date()) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + 3600000 * 8);
  }

  function checkOffPeakStatus(date = new Date()) {
    const bj = getBeijingTime(date);
    const day = bj.getDay(); // 0 是周日, 6 是周六
    const hour = bj.getHours();
    const min = bj.getMinutes();
    const t = hour + min / 60;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

    // 周末全天均为低谷闲时 (立享 5 折)
    if (day === 0 || day === 6) {
      return {
        isOffPeak: true,
        discount: 0.5,
        hour,
        min,
        day,
        timeStr,
        reason: "weekend"
      };
    }

    // 工作日：高峰为 09:00-12:00 与 14:00-18:00；其余时段为低谷闲时
    const isPeak = (t >= 9 && t < 12) || (t >= 14 && t < 18);
    return {
      isOffPeak: !isPeak,
      discount: !isPeak ? 0.5 : 1.0,
      hour,
      min,
      day,
      timeStr,
      reason: isPeak ? "workday_peak" : t >= 12 && t < 14 ? "lunch" : "night"
    };
  }

  function updatePeakStatusBar() {
    const status = checkOffPeakStatus();
    const bar = $("peak-status-bar");
    const text = $("peak-text");
    const time = $("peak-time");
    if (!bar || !text) return;

    if (status.isOffPeak) {
      bar.className = "peak-status-bar is-offpeak";
      text.textContent = t("offpeak_badge_live");
    } else {
      bar.className = "peak-status-bar is-peak";
      text.textContent = t("peak_badge_live");
    }
    if (time) {
      time.textContent = `UTC+8 ${status.timeStr}`;
    }
  }

  // 4. 定价计算 (含实时峰谷切换)
  function getModelPrice(item) {
    const currentStatus = checkOffPeakStatus();
    const isSub = item.providerKind === "subscription";

    const specificCustom = customPrices[item.model];
    const bare = getBareModel(item.model);
    const wildcardCustom = customPrices["*/" + bare];
    const custom = specificCustom || wildcardCustom;
    const scope = specificCustom ? "specific" : wildcardCustom ? "wildcard" : null;

    if (globalMode === "api-only" && isSub && !specificCustom) {
      return null;
    }

    // 自定义定价
    if (custom) {
      const hasOffPeak = !!(custom.offpeak?.enabled || item.offPeakPreset?.supported);
      const peakIn = custom.input;
      const peakOut = custom.output;
      const offIn = custom.offpeak?.input ?? +(peakIn * 0.5).toFixed(5);
      const offOut = custom.offpeak?.output ?? +(peakOut * 0.5).toFixed(5);

      const effectiveIn = hasOffPeak && currentStatus.isOffPeak ? offIn : peakIn;
      const effectiveOut = hasOffPeak && currentStatus.isOffPeak ? offOut : peakOut;

      return {
        type: "custom",
        scope,
        input: effectiveIn,
        output: effectiveOut,
        cache_read: custom.cache_read,
        cache_write: custom.cache_write,
        hasOffPeak,
        isOffPeakActive: currentStatus.isOffPeak,
        peakInput: peakIn,
        peakOutput: peakOut,
        offPeakInput: offIn,
        offPeakOutput: offOut
      };
    }

    // 官方匹配公价 (若为 DeepSeek 等模型，自动计算峰谷)
    if (item.matched && item.matched.cost) {
      const c = item.matched.cost;
      const hasOffPeak = !!item.offPeakPreset?.supported;
      const peakIn = c.input;
      const peakOut = c.output;
      const offIn = +(peakIn * 0.5).toFixed(5);
      const offOut = +(peakOut * 0.5).toFixed(5);

      const effectiveIn = hasOffPeak && currentStatus.isOffPeak ? offIn : peakIn;
      const effectiveOut = hasOffPeak && currentStatus.isOffPeak ? offOut : peakOut;

      return {
        type: "matched",
        input: effectiveIn,
        output: effectiveOut,
        cache_read: c.cache_read,
        cache_write: c.cache_write,
        hasOffPeak,
        isOffPeakActive: currentStatus.isOffPeak,
        peakInput: peakIn,
        peakOutput: peakOut,
        offPeakInput: offIn,
        offPeakOutput: offOut
      };
    }

    if (item.currentPrice && !item.isUnpriced) {
      return {
        type: "current",
        text: item.currentPrice
      };
    }
    return null;
  }

  function renderModeUI() {
    if (globalMode === "api-only") {
      $("mode-btn-api").setAttribute("aria-selected", "true");
      $("mode-btn-all").removeAttribute("aria-selected");
      $("mode-desc-text").innerHTML = t("mode_desc_api");
    } else {
      $("mode-btn-all").setAttribute("aria-selected", "true");
      $("mode-btn-api").removeAttribute("aria-selected");
      $("mode-desc-text").innerHTML = t("mode_desc_all");
    }
  }

  function renderStats() {
    const total = rawModels.length;
    let customCount = 0;
    let pricedCount = 0;
    let unpricedCount = 0;

    for (const m of rawModels) {
      const p = getModelPrice(m);
      if (p) {
        pricedCount++;
        if (p.type === "custom") customCount++;
      } else {
        unpricedCount++;
      }
    }

    $("stat-total").textContent = total;
    $("stat-priced").textContent = pricedCount;
    $("stat-custom").textContent = customCount;
    $("stat-unpriced").textContent = unpricedCount;
  }

  function renderList() {
    let list = rawModels;

    if (filter === "custom") {
      list = list.filter((m) => {
        const p = getModelPrice(m);
        return p && p.type === "custom";
      });
    } else if (filter === "unpriced") {
      list = list.filter((m) => !getModelPrice(m));
    } else if (filter === "matched") {
      list = list.filter((m) => !!m.matched);
    } else if (filter === "offpeak") {
      list = list.filter((m) => {
        const p = getModelPrice(m);
        return (p && p.hasOffPeak) || (m.offPeakPreset && m.offPeakPreset.supported);
      });
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.model.toLowerCase().includes(q) ||
          (m.name && m.name.toLowerCase().includes(q)) ||
          (m.matched && (m.matched.provider + "/" + m.matched.model).toLowerCase().includes(q))
      );
    }

    const listContainer = $("models-list");
    listContainer.innerHTML = "";

    if (list.length === 0) {
      $("empty-hint").hidden = false;
      return;
    }
    $("empty-hint").hidden = true;

    for (const item of list) {
      const li = document.createElement("li");
      li.className = "model-item";

      const topDiv = document.createElement("div");
      topDiv.className = "item-top";

      const isSub = item.providerKind === "subscription";
      const kindBadge = isSub
        ? `<span style="font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; margin-left: 5px;">${escapeHtml(t("badge_subscription"))}</span>`
        : `<span style="font-size: 10px; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 4px; margin-left: 5px;">${escapeHtml(t("badge_paid_api"))}</span>`;

      const offPeakTag = item.offPeakPreset?.supported
        ? `<span style="font-size: 10px; color: var(--green); border: 1px solid rgba(48, 209, 88, 0.3); border-radius: 3px; padding: 0 4px; margin-left: 5px;" title="${escapeHtml(item.offPeakPreset.name)}">${escapeHtml(t("badge_offpeak_supported"))}</span>`
        : "";

      const infoDiv = document.createElement("div");
      infoDiv.className = "item-info";
      infoDiv.innerHTML =
        '<div class="m-name">' +
        escapeHtml(item.model) +
        kindBadge +
        offPeakTag +
        "</div>" +
        '<div class="m-sub">' +
        escapeHtml(item.name || "") +
        "</div>";

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "item-actions";

      const btnEdit = document.createElement("button");
      btnEdit.type = "button";
      btnEdit.className = "btn btn-small";
      btnEdit.textContent = t("btn_edit_price");
      btnEdit.addEventListener("click", () => openEditModal(item));
      actionsDiv.append(btnEdit);

      const current = getModelPrice(item);
      const bare = getBareModel(item.model);
      const hasCustom = !!(customPrices[item.model] || customPrices["*/" + bare]);

      if (hasCustom) {
        const btnReset = document.createElement("button");
        btnReset.type = "button";
        btnReset.className = "btn btn-small";
        btnReset.style.color = "var(--red)";
        btnReset.textContent = t("btn_reset");
        btnReset.addEventListener("click", () => resetModelPrice(item.model));
        actionsDiv.append(btnReset);
      }

      topDiv.append(infoDiv, actionsDiv);

      const bottomDiv = document.createElement("div");
      bottomDiv.className = "item-bottom";

      const priceCol = document.createElement("div");
      priceCol.className = "price-col";

      if (current && (current.type === "custom" || current.type === "matched")) {
        const scopeBadge =
          current.type === "custom"
            ? current.scope === "wildcard"
              ? `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_wildcard_badge_title"))}">${escapeHtml(t("scope_wildcard_badge"))}</span>`
              : `<span class="badge-tag badge-custom" title="${escapeHtml(t("scope_specific_badge_title"))}">${escapeHtml(t("scope_specific_badge"))}</span>`
            : "";

        if (current.hasOffPeak) {
          const peakLabel = t("peak_tag");
          const offpeakLabel = t("offpeak_tag");
          const statusBadge = current.isOffPeakActive
            ? `<span class="badge-tag badge-offpeak" title="当前时段按闲时 5 折计算">$${current.offPeakInput}/$${current.offPeakOutput} (${escapeHtml(t("badge_offpeak_active"))})</span>`
            : `<span class="badge-tag badge-peak" title="当前时段按高峰标准单价计算">$${current.peakInput}/$${current.peakOutput} (${escapeHtml(t("badge_peak_active"))})</span>`;

          priceCol.innerHTML =
            `<span class="rate">${peakLabel} $${current.peakInput}/$${current.peakOutput}</span>` +
            `<span class="rate-offpeak">${offpeakLabel} $${current.offPeakInput}/$${current.offPeakOutput} (50% OFF)</span>` +
            statusBadge +
            scopeBadge +
            `<span class="cache">${escapeHtml(t("cache_label"))} $${current.cache_read}/$${current.cache_write}</span>`;
        } else {
          priceCol.innerHTML =
            '<span class="rate">$' +
            current.input +
            " / $" +
            current.output +
            "</span>" +
            scopeBadge +
            `<span class="badge-tag badge-modelsdev">${escapeHtml(t("badge_active"))}</span>` +
            `<span class="cache">${escapeHtml(t("cache_label"))} $${current.cache_read}/$${current.cache_write}</span>`;
        }
      } else if (current && current.type === "current") {
        priceCol.innerHTML =
          '<span class="rate" style="color: var(--green);">' +
          escapeHtml(current.text) +
          "</span>" +
          `<span class="badge-tag badge-modelsdev">${escapeHtml(t("badge_active"))}</span>`;
      } else {
        if (globalMode === "api-only" && isSub) {
          priceCol.innerHTML = `<span class="badge-tag" style="background: var(--card); color: var(--muted);">${escapeHtml(t("badge_free_tier"))}</span>`;
        } else {
          priceCol.innerHTML = `<span class="badge-tag badge-unpriced">${escapeHtml(t("badge_unpriced"))}</span>`;
        }
      }

      const refCol = document.createElement("div");
      refCol.className = "ref-col";
      if (item.matched) {
        const c = item.matched.cost;
        refCol.innerHTML =
          `<span>${escapeHtml(t("market_ref_prefix"))}</span> ` +
          '<span class="ref-price">$' +
          c.input +
          " / $" +
          c.output +
          "</span>";
      } else {
        refCol.innerHTML = `<span>${escapeHtml(t("no_market_ref"))}</span>`;
      }

      bottomDiv.append(priceCol, refCol);
      li.append(topDiv, bottomDiv);
      listContainer.append(li);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 5. 编辑定价弹窗交互
  function openEditModal(item) {
    editingModel = item;
    const bare = getBareModel(item.model);

    $("modal-model-title").textContent = t("modal_title_set", { model: item.model });
    $("modal-model-sub").textContent = item.name
      ? t("modal_sub_official", { name: item.name })
      : t("modal_sub_default");
    $("scope-model-label").textContent = item.model;
    $("scope-wild-label").textContent = bare;

    if (customPrices["*/" + bare] && !customPrices[item.model]) {
      setScope("wildcard");
    } else {
      setScope("specific");
    }

    const current = getModelPrice(item);
    const specificCustom = customPrices[item.model];
    const wildcardCustom = customPrices["*/" + bare];
    const custom = specificCustom || wildcardCustom;

    if (custom) {
      $("input-cost").value = custom.input;
      $("output-cost").value = custom.output;
      $("cache-read-cost").value = custom.cache_read;
      $("cache-write-cost").value = custom.cache_write;

      const hasOffPeak = !!(custom.offpeak?.enabled || item.offPeakPreset?.supported);
      $("offpeak-enabled").checked = hasOffPeak;
      $("offpeak-details").hidden = !hasOffPeak;
      $("offpeak-input-cost").value = custom.offpeak?.input ?? +(custom.input * 0.5).toFixed(5);
      $("offpeak-output-cost").value = custom.offpeak?.output ?? +(custom.output * 0.5).toFixed(5);
    } else if (item.matched) {
      const c = item.matched.cost;
      $("input-cost").value = c.input;
      $("output-cost").value = c.output;
      $("cache-read-cost").value = c.cache_read;
      $("cache-write-cost").value = c.cache_write;

      const hasOffPeak = !!item.offPeakPreset?.supported;
      $("offpeak-enabled").checked = hasOffPeak;
      $("offpeak-details").hidden = !hasOffPeak;
      $("offpeak-input-cost").value = +(c.input * 0.5).toFixed(5);
      $("offpeak-output-cost").value = +(c.output * 0.5).toFixed(5);
    } else {
      $("input-cost").value = "0";
      $("output-cost").value = "0";
      $("cache-read-cost").value = "0";
      $("cache-write-cost").value = "0";
      $("offpeak-enabled").checked = false;
      $("offpeak-details").hidden = true;
      $("offpeak-input-cost").value = "0";
      $("offpeak-output-cost").value = "0";
    }

    $("edit-modal").hidden = false;
    $("input-cost").focus();
  }

  function setScope(scope) {
    selectedScope = scope;
    if (scope === "wildcard") {
      $("scope-wildcard").setAttribute("aria-selected", "true");
      $("scope-specific").removeAttribute("aria-selected");
      $("scope-hint").textContent = t("scope_hint_wildcard", {
        model: getBareModel(editingModel?.model || "")
      });
    } else {
      $("scope-specific").setAttribute("aria-selected", "true");
      $("scope-wildcard").removeAttribute("aria-selected");
      $("scope-hint").textContent = t("scope_hint_specific", {
        model: editingModel?.model || ""
      });
    }
  }

  function closeEditModal() {
    $("edit-modal").hidden = true;
    editingModel = null;
  }

  async function saveModelPrice() {
    if (!editingModel) return;
    const bare = getBareModel(editingModel.model);
    const targetKey = selectedScope === "wildcard" ? "*/" + bare : editingModel.model;

    const inVal = parseFloat($("input-cost").value) || 0;
    const outVal = parseFloat($("output-cost").value) || 0;

    const priceObj = {
      input: inVal,
      output: outVal,
      cache_read: parseFloat($("cache-read-cost").value) || 0,
      cache_write: parseFloat($("cache-write-cost").value) || 0
    };

    if ($("offpeak-enabled").checked) {
      priceObj.offpeak = {
        enabled: true,
        rule: "deepseek",
        input: parseFloat($("offpeak-input-cost").value) || +(inVal * 0.5).toFixed(5),
        output: parseFloat($("offpeak-output-cost").value) || +(outVal * 0.5).toFixed(5)
      };
    }

    customPrices[targetKey] = priceObj;

    if (selectedScope === "wildcard" && customPrices[editingModel.model]) {
      delete customPrices[editingModel.model];
    }

    await persistOptions();
    closeEditModal();
    renderStats();
    renderList();
    showToast(t("toast_rate_saved", { key: targetKey }));
  }

  async function resetModelPrice(model) {
    const bare = getBareModel(model);
    delete customPrices[model];
    delete customPrices["*/" + bare];

    await persistOptions();
    renderStats();
    renderList();
    showToast(t("toast_rate_reset", { model }));
  }

  async function setGlobalMode(mode) {
    globalMode = mode;
    renderModeUI();
    await persistOptions();
    renderStats();
    renderList();
    showToast(mode === "api-only" ? t("toast_mode_api") : t("toast_mode_all"));
  }

  async function persistOptions() {
    if (globalThis.magpie && magpie.options) {
      try {
        pluginOptions = await magpie.options.set({
          ...pluginOptions,
          mode: globalMode,
          customPrices
        });
      } catch (e) {
        console.error("Failed to save options via magpie bridge:", e);
      }
    }
  }

  async function syncAllMatched() {
    let count = 0;
    const currentStatus = checkOffPeakStatus();
    for (const m of rawModels) {
      if (m.matched) {
        const hasOffPeak = !!m.offPeakPreset?.supported;
        const peakIn = m.matched.cost.input;
        const peakOut = m.matched.cost.output;
        const offIn = +(peakIn * 0.5).toFixed(5);
        const offOut = +(peakOut * 0.5).toFixed(5);

        customPrices[m.model] = {
          input: peakIn,
          output: peakOut,
          cache_read: m.matched.cost.cache_read,
          cache_write: m.matched.cost.cache_write,
          ...(hasOffPeak ? { offpeak: { enabled: true, rule: "deepseek", input: offIn, output: offOut } } : {})
        };
        count++;
      }
    }
    await persistOptions();
    renderStats();
    renderList();
    showToast(t("toast_sync_all", { count }));
  }

  // 6. 事件绑定
  $("filter-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    $("filter-seg")
      .querySelectorAll("button")
      .forEach((b) => b.removeAttribute("aria-selected"));
    btn.setAttribute("aria-selected", "true");
    filter = btn.dataset.filter;
    renderList();
  });

  $("mode-btn-all").addEventListener("click", () => setGlobalMode("all-equivalent"));
  $("mode-btn-api").addEventListener("click", () => setGlobalMode("api-only"));

  $("scope-specific").addEventListener("click", () => setScope("specific"));
  $("scope-wildcard").addEventListener("click", () => setScope("wildcard"));

  $("search-input").addEventListener("input", (e) => {
    search = e.target.value;
    renderList();
  });

  $("modal-btn-cancel").addEventListener("click", (e) => {
    e.stopPropagation();
    closeEditModal();
  });

  $("edit-modal").addEventListener("click", (e) => {
    if (e.target === $("edit-modal")) {
      closeEditModal();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("edit-modal").hidden) {
      closeEditModal();
    }
  });

  $("modal-btn-save").addEventListener("click", saveModelPrice);
  $("btn-sync-all").addEventListener("click", syncAllMatched);

  $("modal-btn-match").addEventListener("click", () => {
    if (editingModel && editingModel.matched) {
      const c = editingModel.matched.cost;
      $("input-cost").value = c.input;
      $("output-cost").value = c.output;
      $("cache-read-cost").value = c.cache_read;
      $("cache-write-cost").value = c.cache_write;
      if ($("offpeak-enabled").checked) {
        $("offpeak-input-cost").value = +(c.input * 0.5).toFixed(5);
        $("offpeak-output-cost").value = +(c.output * 0.5).toFixed(5);
      }
    }
  });

  $("offpeak-enabled").addEventListener("change", (e) => {
    $("offpeak-details").hidden = !e.target.checked;
    if (e.target.checked) {
      const inVal = parseFloat($("input-cost").value) || 0;
      const outVal = parseFloat($("output-cost").value) || 0;
      if (!parseFloat($("offpeak-input-cost").value)) {
        $("offpeak-input-cost").value = +(inVal * 0.5).toFixed(5);
      }
      if (!parseFloat($("offpeak-output-cost").value)) {
        $("offpeak-output-cost").value = +(outVal * 0.5).toFixed(5);
      }
    }
  });

  $("input-cost").addEventListener("input", () => {
    if ($("offpeak-enabled").checked) {
      const inVal = parseFloat($("input-cost").value) || 0;
      $("offpeak-input-cost").value = +(inVal * 0.5).toFixed(5);
    }
  });

  $("output-cost").addEventListener("input", () => {
    if ($("offpeak-enabled").checked) {
      const outVal = parseFloat($("output-cost").value) || 0;
      $("offpeak-output-cost").value = +(outVal * 0.5).toFixed(5);
    }
  });

  // 当语言切换时，触发全量 UI 重新渲染
  onLocaleChange(() => {
    updatePeakStatusBar();
    renderModeUI();
    renderStats();
    renderList();
    if (editingModel && !$("edit-modal").hidden) {
      $("modal-model-title").textContent = t("modal_title_set", { model: editingModel.model });
      $("modal-model-sub").textContent = editingModel.name
        ? t("modal_sub_official", { name: editingModel.name })
        : t("modal_sub_default");
      setScope(selectedScope);
    }
  });

  // 定时更新峰谷状态胶囊 (每 30 秒)
  setInterval(updatePeakStatusBar, 30000);

  // 初始渲染
  updatePeakStatusBar();
  renderModeUI();
  renderStats();
  renderList();
})();
