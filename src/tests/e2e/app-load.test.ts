import { test, expect } from '@playwright/test';

test.describe('LeafSpace E2E - App Initialization', () => {
  test('should load the application shell', async ({ page }) => {
    await page.goto('/');
    
    // 验证根元素是否存在
    const root = await page.locator('#root');
    await expect(root).toBeVisible();
    
    // 验证 React 默认内容是否存在 (后期会由 Agent 1/2 替换为真实 UI)
    await expect(page.locator('h1')).toContainText('LeafSpace');
  });
});
