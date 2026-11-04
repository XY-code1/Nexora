import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/phase8-acceptance')
test.beforeAll(() => mkdirSync(shots, { recursive: true }))

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '成长仪表盘' }).click()
  await expect(page.getByRole('heading', { name: 'Personal Growth Intelligence' })).toBeVisible()
}

test('Phase 8 persists user-authored growth records without inferred scores', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await connect(page)

  await expect(page.getByText('还没有任何已确认的成长记录。先从「月度复盘」或「成长自评」开始。')).toBeVisible()
  await page.getByRole('tab', { name: 'Growth Assessment' }).click()
  await page.getByLabel('新建自评月份').fill('2026-09')
  await page.getByRole('button', { name: '新建自评' }).click()

  for (const [dimension, value] of [
    ['MIND', '用户记录：本月完成了一次系统化学习。'],
    ['BODY', '用户记录：本月主动调整了休息节奏。'],
    ['SPIRIT', '用户记录：本月与重要的人保持沟通。'],
    ['VOCATION', '用户记录：本月交付了 Personal AI Profile。'],
  ] as const) {
    const fieldset = page.locator('fieldset.assess-dim').filter({ hasText: dimension })
    await fieldset.getByLabel('当前状态').fill(value)
    await fieldset.getByLabel('成长证据').fill(`由用户填写的 ${dimension} 证据。`)
    await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/dimensions/${dimension.toLowerCase()}`) && response.request().method() === 'PUT'),
      fieldset.getByRole('button', { name: `保存 ${dimension}` }).click(),
    ])
  }
  await page.getByLabel('参考层级').selectOption('2.0')
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/level') && response.request().method() === 'PUT'),
    page.getByRole('button', { name: '保存层级' }).click(),
  ])
  await expect(page.getByRole('button', { name: '确认自评' })).toBeEnabled()
  await page.getByRole('button', { name: '确认自评' }).click()
  await expect(page.locator('.assess-list').getByText('confirmed')).toBeVisible()

  await page.getByRole('tab', { name: 'Goals & Actions' }).click()
  await page.getByLabel('目标标题').fill('继续验证本地数据边界')
  await page.getByLabel('具体行动').fill('完成 Phase 8 专项验收')
  await page.getByLabel('截止日期').fill('2026-11-30')
  await page.getByRole('button', { name: '添加目标' }).click()
  await expect(page.getByText('继续验证本地数据边界')).toBeVisible()

  await page.getByRole('tab', { name: 'Cross-Dimension Map' }).click()
  await page.getByLabel('关联说明').fill('用户主动记录学习与工作的相关性')
  await page.getByRole('button', { name: '添加关联' }).click()
  await expect(page.getByText(/用户主动记录学习与工作的相关性/)).toBeVisible()

  await page.getByRole('tab', { name: 'Growth Overview' }).click()
  await expect(page.getByText('2026-09')).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'phase8-growth-1440.png'), fullPage: true })

  await page.reload()
  await connect(page)
  await expect(page.getByText('2026-09')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'phase8-growth-390.png'), fullPage: true })
  expect(await page.getByText(/成长分数/).count()).toBe(1) // explanatory boundary, never a generated score
  expect(errors).toEqual([])
})
