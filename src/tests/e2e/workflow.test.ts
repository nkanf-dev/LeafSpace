// @ts-nocheck

// @ts-nocheck

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// A truly valid minimal PDF file
const MINIMAL_PDF = Buffer.from(
  '255044462d312e310a312030206f626a0a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e0a656e646f626a0a322030206f626a0a3c3c2f547970652f436174616c6f672f436f756e7420312f4b6964735b33203020525d3e3e0a656e646f626a0a332030206f626a0a3c3c2f547970652f506167652f506172656e742032203020522f5265736f75726365733c3c3e3e2f4d65646961426f785b30203020363132203739325d3e3e0a656e646f626a0a747261696c65720a3c3c2f53697a6520342f526f6f742031203020523e3e0a2525454f46',
  'hex'
);

test.describe('LeafSpace - Real World Business Workflow', () => {
  const testPdfPath = path.join(process.cwd(), 'real-world-test.pdf');

  test.beforeAll(() => {
    fs.writeFileSync(testPdfPath, MINIMAL_PDF);
  });

  test.afterAll(() => {
    if (fs.existsSync(testPdfPath)) fs.unlinkSync(testPdfPath);
  });

  test('full cycle: load pdf -> hold page -> verify spatial layout -> check quick flip thumbnails', async ({ page }) => {
    // 1. 进入欢迎页
    await page.goto('/');
    await expect(page.locator('.welcome-screen')).toBeVisible();

    // 2. 真实文件上传
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Select PDF to Start' }).click(),
    ]);
    await fileChooser.setFiles(testPdfPath);

    // 3. 验证加载成功 (匹配真实 UI ID 输出)
    await expect(page.locator('.document-info')).toContainText('ID:', { timeout: 15000 });
    
    // 验证主窗 Canvas 已渲染且可见
    const mainCanvas = page.locator('.reader-window-container.main canvas');
    await expect(mainCanvas).toBeVisible();

    // 4. 执行夹页 (Hold Current)
    await page.getByRole('button', { name: 'Hold Current' }).click();
    
    // 验证侧边栏卡片出现，并且有缩略图占位符或真实图片
    const heldCard = page.locator('.held-page-card');
    await expect(heldCard).toBeVisible();
    await expect(heldCard.locator('.page-num')).toContainText('P.1');

    // 5. 点击卡片开启对比窗口
    await heldCard.click();
    
    // 验证空间布局：现在应该有两个窗口容器
    const windows = page.locator('.reader-window-container');
    await expect(windows).toHaveCount(2);
    
    // 验证参考窗标题
    await expect(page.locator('.reader-window-container').last().locator('.window-title')).toContainText('Page 1');

    // 6. 验证速翻胶带与缩略图加载
    await page.keyboard.press(' ');
    const quickFlip = page.locator('.quick-flip-overlay');
    await expect(quickFlip).toBeVisible();
    
    // 验证速翻项中是否存在页面元素
    const flipItem = page.locator('.quick-flip-item.active');
    await expect(flipItem).toBeVisible();
    await expect(flipItem.locator('.page-label')).toHaveText('1');

    // 验证键盘关闭
    await page.keyboard.press('Escape');
    await expect(quickFlip).not.toBeVisible();
  });
});
