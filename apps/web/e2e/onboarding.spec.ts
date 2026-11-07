import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/onboarding-qa')

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('daily workspace removes the duplicate onboarding destination', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await expect(page.getByRole('button', { name: '对话式引导' })).toHaveCount(0)
  await page.getByRole('button', { name: '个人档案' }).click()
  await expect(page.getByRole('heading', { name: '个人档案', level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'workspace-without-onboarding-1440.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'workspace-without-onboarding-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
