#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const matcher = require('./matcher');

const SETTINGS_PATH = path.join(process.env.HOME || '', '.config/magpie/settings.json');

function syncModeAndPrices(options) {
  if (!options || typeof options !== 'object') return;
  try {
    const mode = options.mode || 'all-equivalent';
    const customPrices = options.customPrices || {};
    matcher.applyGlobalMode(mode, customPrices);
    console.log(`Synchronized mode [${mode}] and custom prices to Magpie settings.json`);
  } catch (err) {
    console.error('Failed to sync mode and prices:', err.message);
  }
}

// OpenCode / Magpie Plugin export
async function MagpieModelPricesPlugin(input, options) {
  if (options) {
    syncModeAndPrices(options);
  }

  return {
    async config(cfg) {
      const opts = input?.magpie?.options?.() || options;
      if (opts) {
        syncModeAndPrices(opts);
      }
    }
  };
}

module.exports = MagpieModelPricesPlugin;
module.exports.default = MagpieModelPricesPlugin;
module.exports.MagpieModelPricesPlugin = MagpieModelPricesPlugin;

// CLI runner when executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  async function main() {
    if (command === 'list' || command === 'status') {
      console.log('\n🔍 正在扫描 Magpie 活跃模型与 models.dev 数据库...\n');
      const report = matcher.scanAll();
      const unpriced = report.filter(r => r.isUnpriced);
      const priced = report.filter(r => !r.isUnpriced);
      const offPeak = matcher.checkOffPeakStatus();

      console.log(`📊 统计概览: 总模型 ${report.length} 个 | 已定价 ${priced.length} 个 | 未定价 ${unpriced.length} 个`);
      console.log(`⏰ 当前分时状态: ${offPeak.label} (${offPeak.isOffPeak ? '🌙 闲时低谷 5折生效中' : '⚡ 正常高峰时段'})\n`);

      if (unpriced.length === 0) {
        console.log('🎉 太棒了！当前所有模型均已有定价。');
        return;
      }

      console.log('---------------------------------------------------------------------------------------------------------');
      console.log('未定价 Magpie 模型                     ->  智能匹配 models.dev 模型            输入 / 输出单价 (USD/1M)');
      console.log('---------------------------------------------------------------------------------------------------------');

      for (const item of unpriced) {
        const target = item.model.padEnd(38);
        if (item.matched) {
          const mStr = (item.matched.provider + '/' + item.matched.model).padEnd(34);
          const costStr = `$${item.matched.cost.input} / $${item.matched.cost.output}`;
          console.log(`${target} ->  ${mStr} ${costStr}`);
        } else {
          console.log(`${target} ->  [无法自动匹配，需手动指定]`);
        }
      }
      console.log('---------------------------------------------------------------------------------------------------------');
      console.log('\n💡 执行命令:');
      console.log('  node index.js mode api-only   切换为仅统计 API 真实支出');
      console.log('  node index.js mode all        切换为显示所有渠道等值公价');
      console.log('  node index.js sync            一键自动应用匹配价格到 Magpie');
      console.log('  node index.js ui              启动可视化网页控制台进行精细化调整\n');
      return;
    }

    if (command === 'mode') {
      const targetMode = args[1];
      if (targetMode === 'api-only' || targetMode === 'api') {
        const n = matcher.applyGlobalMode('api-only');
        console.log(`✓ 已切换为【仅计费真实付费 API】：包月/免费渠道已全部免计费，已配置 ${n} 个条目。`);
        return;
      } else if (targetMode === 'all' || targetMode === 'all-equivalent') {
        const n = matcher.applyGlobalMode('all-equivalent');
        console.log(`✓ 已切换为【显示所有渠道等值公价】：所有模型按市场参考价估算，已配置 ${n} 个条目。`);
        return;
      } else {
        console.log('用法: node index.js mode <api-only|all>');
        return;
      }
    }

    if (command === 'sync') {
      const isDryRun = args.includes('--dry-run');
      console.log(`\n🚀 正在开始${isDryRun ? '【模拟】' : ''}自动同步价格到 Magpie...\n`);

      const report = matcher.scanAll();
      const unpriced = report.filter(r => r.isUnpriced && r.matched);

      if (unpriced.length === 0) {
        console.log('当前没有需要同步的未定价模型。');
        return;
      }

      let successCount = 0;
      for (const item of unpriced) {
        const priceStr = item.matched.priceString;
        if (isDryRun) {
          console.log(`[DRY-RUN] applyPrice: ${item.model} -> ${priceStr}`);
          successCount++;
        } else {
          try {
            const res = matcher.applyPrice(item.model, priceStr);
            console.log(`✓ 成功设置 ${item.model} -> ${priceStr} (${res})`);
            successCount++;
          } catch (e) {
            console.error(`✗ 设置失败 ${item.model}: ${e.message}`);
          }
        }
      }

      console.log(`\n✨ 完成！已${isDryRun ? '计划' : '成功'}设置 ${successCount} / ${unpriced.length} 个模型价格。\n`);
      return;
    }

    if (command === 'set') {
      const model = args[1];
      const priceStr = args[2];
      if (!model || !priceStr) {
        console.log('用法: node index.js set <provider/model> <in,out,cache_read,cache_write>');
        return;
      }
      try {
        const res = matcher.applyPrice(model, priceStr);
        console.log(`✓ ${res}`);
      } catch (e) {
        console.error('✗ 设置失败:', e.message);
      }
      return;
    }

    if (command === 'reset') {
      console.log('\n🔄 正在重置模型价格...\n');
      const targetModel = args.find(a => !a.startsWith('-') && a !== 'reset');
      if (!targetModel) {
        console.log('请指定要重置的模型名，例如: node index.js reset workbuddy/deepseek-v4.1-flash');
        return;
      }
      try {
        const res = matcher.resetPrice(targetModel);
        console.log(`✓ ${res}`);
      } catch (e) {
        console.error(`✗ 重置失败: ${e.message}`);
      }
      return;
    }

    if (command === 'ui' || command === 'serve') {
      const { startServer } = require('./server');
      const portArg = args.find(a => a.startsWith('--port='));
      const port = portArg ? parseInt(portArg.split('=')[1]) : 3456;
      await startServer(port);
      return;
    }

    console.log('未知命令: ' + command);
    console.log('支持的命令: list, mode, sync, set, reset, ui');
  }

  main().catch(err => {
    console.error('执行出错:', err);
    process.exit(1);
  });
}
