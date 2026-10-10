/**
 * Renders the PWA icons (192/512) with Playwright into web/public/.
 * Run once after changing the logo: `bun scripts/icons.ts`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const html = `<!doctype html>
<html>
  <body style="margin:0">
    <div style="width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0e">
      <div style="width:66%;height:66%;border:1.2vw solid rgba(139,92,246,.55);background:rgba(139,92,246,.12);display:flex;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:800;font-size:26vw;letter-spacing:0.4vw;color:#a78bfa">VS</div>
    </div>
  </body>
</html>`;

const outDir = join(import.meta.dir, "..", "public");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  await page.screenshot({ path: join(outDir, `icon-${size}.png`) });
  await page.close();
  console.log(`wrote icon-${size}.png`);
}
await browser.close();
