import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const shots = resolve(process.cwd(), '../../artifacts/phase2.1-navigation')

async function connect(page: import('@playwright/test').Page) {
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
}

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('hash navigation restores scroll, focus, history and refresh state', async ({ page }) => {
  await page.goto('/#/overview')
  await connect(page)
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeFocused()

  const stage = page.locator('.app-stage')
  await page.locator('.content-shell').evaluate((element) => { (element as HTMLElement).style.minHeight = '2000px' })
  await stage.evaluate((element) => { element.scrollTop = 600 })
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  await page.getByRole('button', { name: '记忆审核' }).click()
  await expect(page).toHaveURL(/#\/memory-review$/)
  await expect(page.getByRole('heading', { name: '记忆审核', level: 1 })).toBeFocused()
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(0)

  await page.getByRole('button', { name: '个人档案' }).click()
  await expect(page).toHaveURL(/#\/profile$/)
  await expect(page.getByRole('heading', { name: '个人档案', level: 1 })).toBeFocused()

  await page.goBack()
  await expect(page).toHaveURL(/#\/memory-review$/)
  await expect(page.getByRole('heading', { name: '记忆审核', level: 1 })).toBeFocused()
  await page.goForward()
  await expect(page).toHaveURL(/#\/profile$/)

  await page.reload()
  await expect(page.getByRole('heading', { name: '连接你的本地档案' })).toBeVisible()
  await expect(page).toHaveURL(/#\/profile$/)
  await connect(page)
  await expect(page.getByRole('heading', { name: '个人档案', level: 1 })).toBeFocused()
  await page.screenshot({ path: resolve(shots, 'desktop-profile-route.png'), fullPage: true })
})

test('invalid route falls back without exposing authentication data', async ({ page }) => {
  await page.goto('/#/not-a-real-page')
  await expect(page).toHaveURL(/#\/overview$/)
  await connect(page)
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeFocused()
  expect(page.url()).not.toContain('e2e-token')
})

test('mobile drawer traps focus, closes with Escape and navigates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/overview')
  await connect(page)

  const menu = page.getByRole('button', { name: '打开导航' })
  await menu.click()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: '概览' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()

  await menu.click()
  await page.getByRole('button', { name: '个人档案' }).click()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: '个人档案', level: 1 })).toBeFocused()
  await expect(page.locator('.app-stage')).toHaveJSProperty('scrollTop', 0)
  await page.waitForTimeout(300)
  await page.screenshot({ path: resolve(shots, 'mobile-profile-route.png'), fullPage: true })
})
