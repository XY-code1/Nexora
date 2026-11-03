import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/security-center-qa')
test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('Security Center authorizes, changes and revokes a real local client', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '隐私审计' }).click()
  await expect(page.getByRole('heading', { name: 'Security Center' })).toBeVisible()

  await page.getByLabel('客户端名称').fill('Synthetic E2E Client')
  await page.locator('.authorize-form label').filter({ hasText: 'profile:read' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: '授权客户端' }).click()
  await expect(page.getByText('客户端凭据仅显示一次')).toBeVisible()
  await expect(page.getByRole('button', { name: /Synthetic E2E Client client-/ })).toBeVisible()
  await page.getByRole('button', { name: '我已安全保存' }).click()

  await page.locator('.scope-editor label').filter({ hasText: 'memory:search' }).getByRole('checkbox').check()
  await page.getByRole('button', { name: '保存权限' }).click()
  await expect(page.locator('.event-table strong', { hasText: 'client.scopes_updated' })).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'security-center-1440.png'), fullPage: true })

  await page.getByRole('button', { name: '撤销授权' }).click()
  await expect(page.getByText(/已撤销/).first()).toBeVisible()
  await expect(page.locator('.event-table strong', { hasText: 'client.revoked' })).toBeVisible()
  await page.locator('.event-table button', { hasText: 'client.revoked' }).click()
  await expect(page.getByRole('dialog', { name: '审计事件详情' })).toBeVisible()
  await page.locator('.event-detail article header button').click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'security-center-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
