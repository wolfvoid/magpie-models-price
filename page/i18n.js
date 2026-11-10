// i18n.js - Model Prices 国际化语言包与控制器 (zh, zh-TW, en, ja) - 含峰谷分时计价

(function () {
  const I18N = {
    "zh": {
      title: "模型价格",
      title_sub: "(Model Prices)",
      tab_all: "全部",
      tab_custom: "自定义",
      tab_matched: "已配公价",
      tab_unpriced: "未定价",
      tab_offpeak: "峰谷定价",
      sub_desc: "基于 models.dev 与 Magpie 账单系统，自动匹配与自定义价格即时生效于每日用量及托盘花费。",
      mode_title: "账单统计口径 (全局计价模式):",
      mode_btn_all: "🌐 显示所有提供商等值公价",
      mode_btn_api: "💳 只记录真实 API 花费",
      mode_desc_all: "【当前：<strong>所有提供商等值公价模式</strong>】对所有渠道（包含 Trae、WorkBuddy、Antigravity 等包月/免费渠道）均按 models.dev 市场公价换算其消耗的等值市值。",
      mode_desc_api: "【当前：<strong>只记录 API 真实花费模式</strong>】仅对真实通过付费 API Key 按量计费的渠道记账；包月会员、免费账号及额度渠道（如 Trae, WorkBuddy, Antigravity 等）计价为 $0.00，不会在托盘与用量统计中产生虚拟金额。",
      tile_active_k: "活跃模型",
      tile_active_s: "已识别模型",
      tile_priced_k: "已生效计费",
      tile_priced_s: "纳入用量账单",
      tile_custom_k: "自定义设价",
      tile_custom_s: "自主设定的价格",
      tile_unpriced_k: "未定价模型",
      tile_unpriced_s: "按 0 花费统计",
      search_placeholder: "搜索模型、渠道或厂商...",
      btn_sync_all: "✨ 全部应用公价",
      empty_hint: "未找到符合条件的模型",
      badge_subscription: "包月/账号",
      badge_paid_api: "付费API",
      btn_edit_price: "修改定价",
      btn_reset: "重置",
      scope_wildcard_badge: "任何渠道 (*)",
      scope_wildcard_badge_title: "通配生效于所有提供此模型的渠道及历史记录",
      scope_specific_badge: "专有渠道",
      scope_specific_badge_title: "仅此特定渠道生效",
      cache_label: "缓存:",
      badge_active: "已生效",
      badge_free_tier: "免记账 (包月/账号)",
      badge_unpriced: "未定价 (Unpriced)",
      market_ref_prefix: "公价参考:",
      no_market_ref: "无公价参考",
      modal_title_default: "自定义模型价格",
      modal_title_set: "设置 {model} 价格",
      modal_sub_official: "官方名称: {name}",
      modal_sub_default: "设定输入、输出及缓存读写单价（USD / 1M Tokens）",
      scope_label: "计费适用范围 (Scope):",
      scope_specific: "仅当前渠道",
      scope_wildcard: "任何供应商",
      scope_hint_specific: "【仅当前渠道模式】：价格仅对当前所选的 {model} 生效，其他渠道该模型不受影响。",
      scope_hint_wildcard: "【任何供应商模式】：价格将写入 */{model}，所有提供此模型的渠道统一以此价格核算！",
      input_cost_label: "输入单价 (Input Cost per 1M):",
      input_cost_ph: "如 0.14",
      output_cost_label: "输出单价 (Output Cost per 1M):",
      output_cost_ph: "如 0.28",
      cache_read_label: "缓存读取单价 (Cache Read per 1M):",
      cache_read_ph: "如 0.014",
      cache_write_label: "缓存写入单价 (Cache Write per 1M):",
      cache_write_ph: "如 0.14",
      btn_cancel: "取消",
      btn_match: "填充公价",
      btn_save: "保存生效",
      toast_rate_saved: "已设置 {key} 单价并生效",
      toast_rate_reset: "已重置 {model} 定价",
      toast_mode_api: "已切换为：仅计费真实付费 API",
      toast_mode_all: "已切换为：显示所有渠道等值公价",
      toast_sync_all: "已应用 {count} 个匹配模型公价",

      // 峰谷分时计价词条 (Peak & Off-Peak)
      peak_badge_live: "⚡ 当前高峰时段",
      offpeak_badge_live: "🌙 当前低谷闲时 (5折生效中)",
      offpeak_desc_banner: "分时计费：工作日 09:00-12:00, 14:00-18:00 为高峰；夜间、午间及周末节假日全天自动按闲时 50% 折扣计算。",
      badge_offpeak_supported: "支持峰谷",
      badge_offpeak_active: "🌙 闲时生效中",
      badge_peak_active: "⚡ 高峰生效中",
      peak_tag: "峰:",
      offpeak_tag: "谷:",
      offpeak_toggle_label: "启用分时峰谷计价 (Peak & Off-Peak)",
      offpeak_preset_ds: "DeepSeek 官方时段 (闲时 5 折)",
      offpeak_preset_custom: "自定义低谷单价",
      offpeak_schedule_desc: "工作日 09:00-12:00 / 14:00-18:00 为高峰；其余时间（夜间 18:00-09:00、午休 12:00-14:00 及周末假日全天）立享 5 折优惠。",
      offpeak_input_label: "低谷输入单价 (Off-Peak In):",
      offpeak_output_label: "低谷输出单价 (Off-Peak Out):",
      offpeak_input_ph: "低谷输入单价 (如 0.07)",
      offpeak_output_ph: "低谷输出单价 (如 0.14)",

      // 我的模型 (My Models)
      view_mine: "我的模型",
      view_all: "全部模型",
      view_desc_mine: "只看你在 Magpie 中配置的渠道与模型，按实际生效价格排列。参考价来自 models.dev。",
      view_desc_all: "基于 models.dev 与 Magpie 账单系统，自动匹配与自定义价格即时生效于每日用量及托盘花费。",
      mm_title: "我的模型",
      mm_basis: "Magpie 已配置渠道 × 本地模型快照",
      mm_refresh: "↻ 刷新配置",
      mm_mode_all: "等值公价",
      mm_mode_api: "真实 API",
      mm_search_ph: "搜索模型、模型 ID 或供应商...",
      mm_provider_search_ph: "搜索渠道...",
      mm_provider_filter: "渠道筛选",
      mm_favorites: "★ 仅收藏",
      mm_hide_unpriced: "隐藏未知价格",
      mm_compare_models: "按模型对比",
      mm_reset: "恢复默认",
      mm_select_all: "全选",
      mm_select_none: "全不选",
      mm_col_provider: "供应商",
      mm_col_model: "模型",
      mm_col_input: "输入",
      mm_col_output: "输出",
      mm_col_cache_read: "缓存读取",
      mm_col_cache_write: "缓存写入",
      mm_col_source: "来源",
      mm_empty: "没有符合条件的模型。",
      mm_empty_reset: "恢复默认筛选",
      toast_mm_refreshed: "已刷新配置（{providers} 个渠道，{models} 个模型）"
    },
    "zh-TW": {
      title: "模型價格",
      title_sub: "(Model Prices)",
      tab_all: "全部",
      tab_custom: "自訂",
      tab_matched: "已配公價",
      tab_unpriced: "未定價",
      tab_offpeak: "峰谷定價",
      sub_desc: "基於 models.dev 與 Magpie 帳單系統，自動匹配與自訂價格即時生效於每日用量及工具列花費。",
      mode_title: "帳單統計口徑 (全域計價模式):",
      mode_btn_all: "🌐 顯示所有提供商等值公價",
      mode_btn_api: "💳 只記錄真實 API 花費",
      mode_desc_all: "【當前：<strong>所有提供商等值公價模式</strong>】對所有渠道（包含 Trae、WorkBuddy、Antigravity 等包月/免費渠道）均按 models.dev 市場公價換算其消耗的等值市值。",
      mode_desc_api: "【當前：<strong>只記錄 API 真實花費模式</strong>】僅對真實通過付費 API Key 按量計費的渠道記帳；包月會員、免費帳號及額度渠道（如 Trae, WorkBuddy, Antigravity 等）計價為 $0.00，不會在工具列與用量統計中產生虛擬金額。",
      tile_active_k: "活躍模型",
      tile_active_s: "已識別模型",
      tile_priced_k: "已生效計費",
      tile_priced_s: "納入用量帳單",
      tile_custom_k: "自訂定價",
      tile_custom_s: "自主設定的價格",
      tile_unpriced_k: "未定價模型",
      tile_unpriced_s: "按 0 花費統計",
      search_placeholder: "搜尋模型、渠道或廠商...",
      btn_sync_all: "✨ 全部套用公價",
      empty_hint: "未找到符合條件的模型",
      badge_subscription: "包月/帳號",
      badge_paid_api: "付費API",
      btn_edit_price: "修改定價",
      btn_reset: "重設",
      scope_wildcard_badge: "任何渠道 (*)",
      scope_wildcard_badge_title: "萬用字元套用於所有提供此模型的渠道及歷史紀錄",
      scope_specific_badge: "專有渠道",
      scope_specific_badge_title: "僅此特定渠道生效",
      cache_label: "快取:",
      badge_active: "已生效",
      badge_free_tier: "免記帳 (包月/帳號)",
      badge_unpriced: "未定價 (Unpriced)",
      market_ref_prefix: "公價參考:",
      no_market_ref: "無公價參考",
      modal_title_default: "自訂模型價格",
      modal_title_set: "設定 {model} 價格",
      modal_sub_official: "官方名稱: {name}",
      modal_sub_default: "設定輸入、輸出及快取讀寫單價（USD / 1M Tokens）",
      scope_label: "計費適用範圍 (Scope):",
      scope_specific: "僅當前渠道",
      scope_wildcard: "任何供應商",
      scope_hint_specific: "【僅當前渠道模式】：價格僅對當前所選的 {model} 生效，其他渠道該模型不受影響。",
      scope_hint_wildcard: "【任何供應商模式】：價格將寫入 */{model}，所有提供此模型的渠道統一以此價格核算！",
      input_cost_label: "輸入單價 (Input Cost per 1M):",
      input_cost_ph: "如 0.14",
      output_cost_label: "輸出單價 (Output Cost per 1M):",
      output_cost_ph: "如 0.28",
      cache_read_label: "快取讀取單價 (Cache Read per 1M):",
      cache_read_ph: "如 0.014",
      cache_write_label: "快取寫入單價 (Cache Write per 1M):",
      cache_write_ph: "如 0.14",
      btn_cancel: "取消",
      btn_match: "填入公價",
      btn_save: "儲存並生效",
      toast_rate_saved: "已設定 {key} 單價並生效",
      toast_rate_reset: "已重設 {model} 定價",
      toast_mode_api: "已切換為：僅計費真實付費 API",
      toast_mode_all: "已切換為：顯示所有渠道等值公價",
      toast_sync_all: "已套用 {count} 個匹配模型公價",

      // 峰谷分時詞條
      peak_badge_live: "⚡ 當前高峰時段",
      offpeak_badge_live: "🌙 當前離峰低谷 (5折生效中)",
      offpeak_desc_banner: "分時計費：工作日 09:00-12:00, 14:00-18:00 為高峰；夜間、午間及週末節假日全天自動按閒時 50% 折扣計算。",
      badge_offpeak_supported: "支援峰谷",
      badge_offpeak_active: "🌙 閒時生效中",
      badge_peak_active: "⚡ 高峰生效中",
      peak_tag: "峰:",
      offpeak_tag: "谷:",
      offpeak_toggle_label: "啟用分時峰谷計價 (Peak & Off-Peak)",
      offpeak_preset_ds: "DeepSeek 官方時段 (閒時 5 折)",
      offpeak_preset_custom: "自訂低谷單價",
      offpeak_schedule_desc: "工作日 09:00-12:00 / 14:00-18:00 為高峰；其餘時間（夜間 18:00-09:00、午休 12:00-14:00 及週末假日全天）立享 5 折優惠。",
      offpeak_input_label: "低谷輸入單價 (Off-Peak In):",
      offpeak_output_label: "低谷輸出單價 (Off-Peak Out):",
      offpeak_input_ph: "低谷輸入單價 (如 0.07)",
      offpeak_output_ph: "低谷輸出單價 (如 0.14)",

      // 我的模型 (My Models)
      view_mine: "我的模型",
      view_all: "全部模型",
      view_desc_mine: "只看你在 Magpie 中配置的渠道與模型，按實際生效價格排列。參考價來自 models.dev。",
      view_desc_all: "基於 models.dev 與 Magpie 帳單系統，自動匹配與自訂價格即時生效於每日用量及托盤花費。",
      mm_title: "我的模型",
      mm_basis: "Magpie 已配置渠道 × 本地模型快照",
      mm_refresh: "↻ 刷新配置",
      mm_mode_all: "等值公價",
      mm_mode_api: "真實 API",
      mm_search_ph: "搜尋模型、模型 ID 或供應商...",
      mm_provider_search_ph: "搜尋渠道...",
      mm_provider_filter: "渠道篩選",
      mm_favorites: "★ 僅收藏",
      mm_hide_unpriced: "隱藏未知價格",
      mm_compare_models: "按模型對比",
      mm_reset: "恢復預設",
      mm_select_all: "全選",
      mm_select_none: "全不選",
      mm_col_provider: "供應商",
      mm_col_model: "模型",
      mm_col_input: "輸入",
      mm_col_output: "輸出",
      mm_col_cache_read: "快取讀取",
      mm_col_cache_write: "快取寫入",
      mm_col_source: "來源",
      mm_empty: "沒有符合條件的模型。",
      mm_empty_reset: "恢復預設篩選",
      toast_mm_refreshed: "已刷新配置（{providers} 個渠道，{models} 個模型）"
    },
    "en": {
      title: "Model Prices",
      title_sub: "",
      tab_all: "All",
      tab_custom: "Custom",
      tab_matched: "Matched",
      tab_unpriced: "Unpriced",
      tab_offpeak: "Time-of-Use",
      sub_desc: "Auto-match and custom-price models via models.dev; changes apply immediately to daily usage and tray spend.",
      mode_title: "Billing Metric (Global Pricing Mode):",
      mode_btn_all: "🌐 All Providers Market Price",
      mode_btn_api: "💳 Actual Paid API Spend Only",
      mode_desc_all: "[Current: <strong>All Providers Market Price</strong>] Calculates equivalent market value via models.dev for all channels, including subscription/free accounts (e.g. Trae, WorkBuddy, Antigravity).",
      mode_desc_api: "[Current: <strong>Actual Paid API Spend Only</strong>] Only bills channels with metered API keys; subscriptions and free allowances (Trae, WorkBuddy, Antigravity) are counted as $0.00 without inflating tray spend.",
      tile_active_k: "Active Models",
      tile_active_s: "Identified models",
      tile_priced_k: "Priced Models",
      tile_priced_s: "Counted in usage bill",
      tile_custom_k: "Custom Priced",
      tile_custom_s: "User-defined rates",
      tile_unpriced_k: "Unpriced Models",
      tile_unpriced_s: "Treated as $0.00 spend",
      search_placeholder: "Search model, provider or vendor...",
      btn_sync_all: "✨ Apply All Market Prices",
      empty_hint: "No matching models found",
      badge_subscription: "Subscription",
      badge_paid_api: "Paid API",
      btn_edit_price: "Edit Rate",
      btn_reset: "Reset",
      scope_wildcard_badge: "Any Provider (*)",
      scope_wildcard_badge_title: "Wildcard applies to all providers of this model and past usage",
      scope_specific_badge: "Specific Provider",
      scope_specific_badge_title: "Applies only to this specific provider",
      cache_label: "Cache:",
      badge_active: "Active",
      badge_free_tier: "Not Billed (Subscription)",
      badge_unpriced: "Unpriced",
      market_ref_prefix: "Market Ref:",
      no_market_ref: "No Market Ref",
      modal_title_default: "Custom Model Pricing",
      modal_title_set: "Set Pricing for {model}",
      modal_sub_official: "Official Name: {name}",
      modal_sub_default: "Configure input, output, and cache rates (USD / 1M Tokens)",
      scope_label: "Billing Scope:",
      scope_specific: "Current Provider Only",
      scope_wildcard: "Any Provider (*)",
      scope_hint_specific: "[Current Provider Mode]: Rate only applies to selected {model}. Other providers offering this model are unaffected.",
      scope_hint_wildcard: "[Any Provider Mode]: Rate will be saved to */{model}. All providers offering this model will share this pricing!",
      input_cost_label: "Input Cost per 1M:",
      input_cost_ph: "e.g. 0.14",
      output_cost_label: "Output Cost per 1M:",
      output_cost_ph: "e.g. 0.28",
      cache_read_label: "Cache Read per 1M:",
      cache_read_ph: "e.g. 0.014",
      cache_write_label: "Cache Write per 1M:",
      cache_write_ph: "e.g. 0.14",
      btn_cancel: "Cancel",
      btn_match: "Fill Market Price",
      btn_save: "Save & Apply",
      toast_rate_saved: "Saved and applied rates for {key}",
      toast_rate_reset: "Reset pricing for {model}",
      toast_mode_api: "Switched to: Only bill actual paid APIs",
      toast_mode_all: "Switched to: Show equivalent market price for all providers",
      toast_sync_all: "Applied market prices to {count} matched models",

      // Peak & Off-Peak terms
      peak_badge_live: "⚡ Peak Hours Active",
      offpeak_badge_live: "🌙 Off-Peak Active (50% OFF)",
      offpeak_desc_banner: "Time-of-Use: Weekdays 09:00-12:00, 14:00-18:00 (UTC+8) are Peak; nights, lunch, weekends & holidays are automatically discounted by 50%.",
      badge_offpeak_supported: "Time-of-Use",
      badge_offpeak_active: "🌙 Off-Peak Active",
      badge_peak_active: "⚡ Peak Active",
      peak_tag: "Peak:",
      offpeak_tag: "Off-Peak:",
      offpeak_toggle_label: "Enable Peak & Off-Peak Pricing",
      offpeak_preset_ds: "DeepSeek Official Schedule (50% OFF)",
      offpeak_preset_custom: "Custom Off-Peak Rates",
      offpeak_schedule_desc: "Peak: Weekdays 09:00-12:00 / 14:00-18:00. Off-Peak: 18:00-09:00, 12:00-14:00, weekends & holidays (enjoy 50% discount).",
      offpeak_input_label: "Off-Peak Input per 1M:",
      offpeak_output_label: "Off-Peak Output per 1M:",
      offpeak_input_ph: "Off-peak in (e.g. 0.07)",
      offpeak_output_ph: "Off-peak out (e.g. 0.14)",

      // My Models
      view_mine: "My Models",
      view_all: "All Models",
      view_desc_mine: "Browse models for your configured Magpie providers with active pricing. Reference pricing from models.dev.",
      view_desc_all: "Based on models.dev and Magpie billing, auto-matched and custom prices take effect immediately on daily usage.",
      mm_title: "My Models",
      mm_basis: "Configured Providers × Local Model Snapshot",
      mm_refresh: "↻ Refresh Config",
      mm_mode_all: "Equivalent",
      mm_mode_api: "Real API",
      mm_search_ph: "Search models, model IDs or providers...",
      mm_provider_search_ph: "Search providers...",
      mm_provider_filter: "Providers",
      mm_favorites: "★ Favorites",
      mm_hide_unpriced: "Hide Unknown Prices",
      mm_compare_models: "Compare by Model",
      mm_reset: "Reset",
      mm_select_all: "Select All",
      mm_select_none: "Deselect All",
      mm_col_provider: "Provider",
      mm_col_model: "Model",
      mm_col_input: "Input",
      mm_col_output: "Output",
      mm_col_cache_read: "Cache Read",
      mm_col_cache_write: "Cache Write",
      mm_col_source: "Source",
      mm_empty: "No matching models.",
      mm_empty_reset: "Reset filters",
      toast_mm_refreshed: "Config refreshed ({providers} providers, {models} models)"
    },
    "ja": {
      title: "モデル価格",
      title_sub: "(Model Prices)",
      tab_all: "すべて",
      tab_custom: "カスタム",
      tab_matched: "公定価格一致",
      tab_unpriced: "未設定",
      tab_offpeak: "時間帯別",
      sub_desc: "models.dev と Magpie 請求システムに基づいて、自動マッチングおよびカスタム価格が毎日の使用量とトレイの支出に即座に反映されます。",
      mode_title: "請求統計基準 (グローバル価格モード):",
      mode_btn_all: "🌐 全プロバイダー同等市場価格を表示",
      mode_btn_api: "💳 実際の API 利用料金のみ記録",
      mode_desc_all: "【現在：<strong>全プロバイダー同等市場価格モード</strong>】サブスクリプション/無料枠（Trae、WorkBuddy、Antigravity 等）を含むすべてのチャネルで、models.dev の公定価格に基づいて同等の価値を算出します。",
      mode_desc_api: "【現在：<strong>実利用料金のみ記録モード</strong>】従量課金の有料 API Key チャネルのみ課金対象とします。月額サブスクや無料アカウント（Trae、WorkBuddy、Antigravity 等）は $0.00 として計算され、トレイに仮想金額は発生しません。",
      tile_active_k: "アクティブモデル",
      tile_active_s: "認識済みモデル",
      tile_priced_k: "価格適用済み",
      tile_priced_s: "使用量請求に計上",
      tile_custom_k: "カスタム設定",
      tile_custom_s: "ユーザー設定価格",
      tile_unpriced_k: "未設定モデル",
      tile_unpriced_s: "費用 0 として集計",
      search_placeholder: "モデル、プロバイダー、ベンダーを検索...",
      btn_sync_all: "✨ すべての公定価格を適用",
      empty_hint: "一致するモデルが見つかりません",
      badge_subscription: "月額/アカウント",
      badge_paid_api: "有料API",
      btn_edit_price: "価格変更",
      btn_reset: "リセット",
      scope_wildcard_badge: "全プロバイダー (*)",
      scope_wildcard_badge_title: "このモデルを提供するすべてのプロバイダーと履歴に適用",
      scope_specific_badge: "特定プロバイダー",
      scope_specific_badge_title: "この特定プロバイダーのみ適用",
      cache_label: "キャッシュ:",
      badge_active: "適用中",
      badge_free_tier: "計上なし (月額/無料枠)",
      badge_unpriced: "未設定 (Unpriced)",
      market_ref_prefix: "公定参考価格:",
      no_market_ref: "公定参考価格なし",
      modal_title_default: "モデル価格設定",
      modal_title_set: "{model} の価格を設定",
      modal_sub_official: "公式名称: {name}",
      modal_sub_default: "入力・出力・キャッシュの単価を設定（USD / 1M トークン）",
      scope_label: "課金適用範囲 (Scope):",
      scope_specific: "現在のプロバイダーのみ",
      scope_wildcard: "任意のプロバイダー (*)",
      scope_hint_specific: "【現在のプロバイダーのみ】：設定価格は選択中の {model} にのみ適用され、他のプロバイダーは影響を受けません。",
      scope_hint_wildcard: "【任意のプロバイダー】：価格は */{model} として保存され、这个模型を提供するすべてのプロバイダーで統一計算されます！",
      input_cost_label: "入力単価 (Input Cost per 1M):",
      input_cost_ph: "例: 0.14",
      output_cost_label: "出力単価 (Output Cost per 1M):",
      output_cost_ph: "例: 0.28",
      cache_read_label: "キャッシュ読取単価 (Cache Read per 1M):",
      cache_read_ph: "例: 0.014",
      cache_write_label: "キャッシュ書込単価 (Cache Write per 1M):",
      cache_write_ph: "例: 0.14",
      btn_cancel: "キャンセル",
      btn_match: "公定価格を入力",
      btn_save: "保存して適用",
      toast_rate_saved: "{key} の単価を設定・適用しました",
      toast_rate_reset: "{model} の価格をリセットしました",
      toast_mode_api: "有料APIの実利用料金のみ記録に変更しました",
      toast_mode_all: "全プロバイダー同等市場価格の表示に変更しました",
      toast_sync_all: "{count} 件の一致モデルに公定価格を適用しました",

      // ピーク/オフピーク用語
      peak_badge_live: "⚡ 現在ピーク時間帯",
      offpeak_badge_live: "🌙 オフピーク適用中 (50% OFF)",
      offpeak_desc_banner: "時間帯別価格: 平日 09:00-12:00, 14:00-18:00 (UTC+8) はピーク。夜間・昼休み・土日祝日は自動的に 50% 割引で計算されます。",
      badge_offpeak_supported: "時間帯別",
      badge_offpeak_active: "🌙 オフピーク適用中",
      badge_peak_active: "⚡ ピーク適用中",
      peak_tag: "ピーク:",
      offpeak_tag: "オフピーク:",
      offpeak_toggle_label: "時間帯別・オフピーク価格を有効化",
      offpeak_preset_ds: "DeepSeek 公式スケジュール (50% OFF)",
      offpeak_preset_custom: "カスタムオフピーク単価",
      offpeak_schedule_desc: "平日 09:00-12:00 / 14:00-18:00 がピーク。18:00-09:00、12:00-14:00 および土日祝日は全日 50% 割引。",
      offpeak_input_label: "オフピーク入力単価:",
      offpeak_output_label: "オフピーク出力単価:",
      offpeak_input_ph: "オフピーク入力単価 (例: 0.07)",
      offpeak_output_ph: "オフピーク出力単価 (例: 0.14)",

      // My Models
      view_mine: "マイモデル",
      view_all: "全モデル",
      view_desc_mine: "Magpieで設定したプロバイダーとモデルのみを表示し、適用中の価格で並べ替えます。参考価格は models.dev 提供。",
      view_desc_all: "models.dev と Magpie 請求システムに基づいて、自動マッチングおよびカスタム価格が即座に反映されます。",
      mm_title: "マイモデル",
      mm_basis: "設定済みプロバイダー × ローカルモデルスナップショット",
      mm_refresh: "↻ 設定を更新",
      mm_mode_all: "公定価格",
      mm_mode_api: "実API",
      mm_search_ph: "モデル、モデルID、プロバイダーを検索...",
      mm_provider_search_ph: "プロバイダーを検索...",
      mm_provider_filter: "プロバイダー絞り込み",
      mm_favorites: "★ お気に入り",
      mm_hide_unpriced: "価格不明を非表示",
      mm_compare_models: "モデル別比較",
      mm_reset: "デフォルトに戻す",
      mm_select_all: "すべて選択",
      mm_select_none: "すべて解除",
      mm_col_provider: "プロバイダー",
      mm_col_model: "モデル",
      mm_col_input: "入力",
      mm_col_output: "出力",
      mm_col_cache_read: "キャッシュ読込",
      mm_col_cache_write: "キャッシュ書込",
      mm_col_source: "ソース",
      mm_empty: "条件に一致するモデルがありません。",
      mm_empty_reset: "フィルターをリセット",
      toast_mm_refreshed: "設定を更新しました（{providers} プロバイダー、{models} モデル）"
    }
  };

  let currentLocale = "zh";
  const listeners = new Set();

  function normalizeLocale(raw) {
    if (!raw) return "zh";
    const lower = String(raw).toLowerCase().replace(/_/g, "-");
    if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower.startsWith("zh-mo") || lower === "zh-hant") {
      return "zh-TW";
    }
    if (lower.startsWith("zh")) {
      return "zh";
    }
    if (lower.startsWith("ja")) {
      return "ja";
    }
    if (lower.startsWith("en")) {
      return "en";
    }
    return "zh";
  }

  function t(key, params = {}) {
    const dict = I18N[currentLocale] || I18N["zh"];
    let str = dict[key] !== undefined ? dict[key] : (I18N["zh"][key] || key);
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
    return str;
  }

  function setLocale(rawLang) {
    const target = normalizeLocale(rawLang);
    currentLocale = target;
    document.documentElement.lang = target;

    const dict = I18N[target] || I18N["zh"];

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key] !== undefined) {
        el.textContent = dict[key];
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] !== undefined) {
        el.setAttribute("placeholder", dict[key]);
      }
    });

    const sub = document.getElementById("header-title-sub");
    if (sub) {
      sub.textContent = dict.title_sub || "";
    }

    for (const fn of listeners) {
      try {
        fn(target);
      } catch (e) {
        console.error("[i18n] listener error:", e);
      }
    }
  }

  function onLocaleChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Auto-detect initial language
  const initial = document.documentElement.lang || (navigator.language ? navigator.language : "zh");
  currentLocale = normalizeLocale(initial);

  window.I18N_MODULE = {
    I18N,
    t,
    setLocale,
    getLocale: () => currentLocale,
    normalizeLocale,
    onLocaleChange
  };
})();
