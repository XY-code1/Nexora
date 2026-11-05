import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/backup-recovery-qa')
test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('managed backup is verified and restored through the guarded local flow', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '备份与恢复' }).click()
  await expect(page.getByRole('heading', { name: '备份与恢复', level: 1 })).toBeVisible()
  await expect(page.getByText('还没有本地备份')).toBeVisible()

  await page.getByRole('button', { name: '创建完整备份' }).click()
  await expect(page.getByText('完整备份已创建并通过哈希校验。')).toBeVisible()
  await expect(page.getByText('hash verified')).toBeVisible()
  await page.getByRole('button', { name: '重新校验备份' }).click()
  await expect(page.getByText('备份结构、Schema 和文件哈希均已验证。')).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'backup-recovery-1440.png'), fullPage: true })

  const phrase = await page.locator('.restore-confirm code').innerText()
  await expect(page.getByRole('button', { name: /创建安全备份并恢复/ })).toBeDisabled()
  await page.getByLabel('恢复确认文字').fill(phrase)
  await page.getByRole('button', { name: /创建安全备份并恢复/ }).click()
  await expect(page.getByText(/恢复完成。系统已先创建安全备份/)).toBeVisible()
  await expect(page.locator('.backup-list>button')).toHaveCount(2)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'backup-recovery-390.png'), fullPage: true })
  expect(errors).toEqual([])
})
