/**
 * 可复用的移动端布局检查脚本（Playwright）
 * 用途：模拟手机视口，扫描页面是否存在 横向溢出 / 元素超出视口 / 容器溢出可视 的尺寸问题。
 *
 * 运行：
 *   node scripts/mobileCheck.cjs [baseURL]  [width] [height]
 *   默认 baseURL=http://localhost:5199 width=393 height=852 (iPhone 14/15 Pro)
 *
 * 依赖：npm i -D playwright
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5199';
const W = parseInt(process.argv[3] || '393', 10);
const H = parseInt(process.argv[4] || '852', 10);
const PAGES = [['home', '/'], ['client', '/client'], ['bank', '/bank']];

function report(title, vw, bodyScrollW, docScrollW, spills, overflows) {
  console.log('\n========================================');
  console.log(`【${title}】 vw=${vw}  bodyScrollW=${bodyScrollW}  docScrollW=${docScrollW}`);
  const pageOverflow = Math.max(bodyScrollW, docScrollW) > vw + 1;
  console.log(`  页面级水平溢出: ${pageOverflow ? '⚠️ 是' : '✅ 否'}`);
  if (spills.length) {
    console.log(`  超出视口的元素 (${spills.length}):`);
    spills.slice(0, 10).forEach(s => console.log(`    - ${s.tag}.${s.cls} w=${s.w} (right=${s.right})`));
  } else {
    console.log('  超出视口的元素: ✅ 无');
  }
  if (overflows.length) {
    console.log(`  内容溢出容器(overflow visible)的元素 (${overflows.length}):`);
    overflows.slice(0, 10).forEach(s => console.log(`    - ${s.tag}.${s.cls} scrollW=${s.scrollW} clientW=${s.clientW}`));
  } else {
    console.log('  溢出容器(overflow visible): ✅ 无');
  }
  return pageOverflow;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  let anyIssue = false;

  for (const [name, path] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bodyScrollW = document.body.scrollWidth;
      const docScrollW = document.documentElement.scrollWidth;

      // 元素是否被某个祖先的 overflow-x 裁剪（即内容在滚动容器内，属正常）
      const isContained = (el) => {
        let p = el.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
          p = p.parentElement;
        }
        return false;
      };

      const spills = [];
      const overflows = [];
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > vw + 2 && !isContained(el)) {
          spills.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), w: Math.round(r.width), right: Math.round(r.right) });
        }
        if (el.scrollWidth > el.clientWidth + 2 && !isContained(el)) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'visible') {
            overflows.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), scrollW: el.scrollWidth, clientW: el.clientWidth });
          }
        }
      });
      return { vw, bodyScrollW, docScrollW, spills, overflows };
    });

    const bad = report(`${name} (${path})`, res.vw, res.bodyScrollW, res.docScrollW, res.spills, res.overflows);
    anyIssue = anyIssue || bad || res.spills.length > 0 || res.overflows.length > 0;
  }

  await browser.close();
  console.log('\n==== 总评 ====');
  console.log(anyIssue ? '⚠️ 发现尺寸/溢出问题，请修复后重跑。' : '✅ 全部通过：无页面级水平溢出，视口内无越界元素。');
  process.exit(anyIssue ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
