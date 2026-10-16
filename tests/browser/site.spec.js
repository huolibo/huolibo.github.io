import { test, expect } from '@playwright/test';

test('knowledge-base navigation opens both standalone games and returns to the hub', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.VPHero')).toContainText('huolibo 的知识库');
  await page.locator('.VPNavBarMenu').getByRole('link', { name: '棋室', exact: true }).click();
  await expect(page.locator('.VPHero')).toContainText('临席棋室');
  await page.locator('.VPHero').getByRole('link', { name: '五子棋 ↗', exact: true }).click();
  await expect(page.locator('#board .square')).toHaveCount(225);
  await page.getByRole('link', { name: '← 返回棋室', exact: true }).click();
  await expect(page.locator('.VPHero')).toContainText('临席棋室');
  await page.locator('.VPHero').getByRole('link', { name: '中国象棋 ↗', exact: true }).click();
  await expect(page.locator('#board .piece')).toHaveCount(32);
});
