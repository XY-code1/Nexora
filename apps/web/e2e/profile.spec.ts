import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/personal-profile-qa')

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
}

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('Personal Profile desktop, empty state, refresh and asset integrity', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await connect(page)
  await page.getByRole('button', { name: '个人档案', exact: true }).click()
  await expect(page.getByText('档案还是空的')).toBeVisible()
  await expect(page.getByText('暂无可展示的已确认记忆')).toBeVisible()
  const map = page.getByRole('img', { name: /全息关系图谱的视觉框架/ })
  await expect(map).toBeVisible()
  expect(await map.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'personal-profile-1440.png'), fullPage: true })

  await page.reload()
  await expect(page.getByRole('heading', { name: '连接你的本地档案' })).toBeVisible()
  expect(page.url()).not.toContain('token=')
  expect(errors).toEqual([])
})

test('Personal Profile narrow layout uses drawer and does not overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await connect(page)
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '个人档案', exact: true }).click()
  await expect(page.getByText('档案还是空的')).toBeVisible()
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'personal-profile-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
