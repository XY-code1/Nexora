import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/onboarding-qa')

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('Conversational Onboarding is consent-gated and responsive', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '对话式引导' }).click()
  await expect(page.getByRole('heading', { name: 'Build your profile through dialogue.' })).toBeVisible()
  await expect(page.getByText('Human confirmation required')).toBeVisible()
  await page.getByLabel('你的回答').fill('这是尚未同意创建候选的回答。')
  await expect(page.getByRole('button', { name: /保存为候选并继续/ })).toBeDisabled()
  await page.getByRole('checkbox', { name: /我同意将这次回答创建为候选记忆/ }).check()
  await expect(page.getByRole('button', { name: /保存为候选并继续/ })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'onboarding-1440.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'onboarding-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
