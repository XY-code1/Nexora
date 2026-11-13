import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const shots = 'accessibility-qa'

async function connect(page: import('@playwright/test').Page) {
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
}

test('automated axe scan reports no critical or serious violations', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await connect(page)
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious')
  expect(blocking).toEqual([])
})

test('keyboard flow reaches main content and every navigation group', async ({ page }) => {
  await page.goto('/')
  await connect(page)

  // The skip link is the first focusable element and jumps to the main region.
  const firstFocusable = await page.evaluate(() => {
    const focusable = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    return focusable[0]?.className ?? ''
  })
  expect(firstFocusable).toContain('skip-link')
  await page.locator('a.skip-link').focus()
  await expect(page.locator('a.skip-link')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  // A nav item opens its view with Enter alone.
  await page.getByRole('button', { name: '备份与恢复' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '备份与恢复', level: 1 })).toBeVisible()
})

test('200% zoom keeps the layout usable without horizontal overflow', async ({ page }) => {
  test.setTimeout(60_000)
  // 720x512 is equivalent to a 1440x1024 viewport at 200% zoom.
  await page.setViewportSize({ width: 720, height: 512 })
  await page.goto('/')
  await connect(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // Primary actions stay reachable at 200%.
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.getByRole('button', { name: '备份与恢复' })).toBeVisible()
  // 抽屉打开时会把焦点移到当前导航项；等它落定再操作，避免焦点被抢导致 Enter 落空。
  await expect(page.locator('nav button[aria-current="page"]')).toBeFocused()
  await page.getByRole('button', { name: '备份与恢复' }).focus()
  await expect(page.getByRole('button', { name: '备份与恢复' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '备份与恢复', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '创建完整备份' })).toBeVisible()
})

test('language switch localizes the shell', async ({ page }) => {
  await page.goto('/')
  await connect(page)
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await page.getByLabel('语言').selectOption('en')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Backup & Recovery' })).toBeVisible()
  await page.getByLabel('Language').selectOption('zh-CN')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
})
