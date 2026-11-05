import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/monthly-reflection-qa')
test.beforeAll(() => mkdirSync(shots, { recursive: true }))

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '月度复盘' }).click()
}

test('Monthly Reflection persists dimensions, events, goals, summary and confirmation', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  await page.setViewportSize({ width: 1440, height: 1024 })
  await connect(page)
  await expect(page.getByRole('heading', { name: '月度复盘', level: 1 })).toBeVisible()
  const create = page.getByRole('button', { name: /创建 \d{4}-\d{2} 复盘/ }).first()
  // 等待归档栏的创建入口渲染完成再点击。数据加载前元素不存在，用 isVisible 猜测会直接跳过点击；
  // 若本月复盘已存在（重复运行共享 Vault），该入口不会出现，此时直接进入已有复盘。
  await create.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
  if (await create.isVisible()) await create.click()
  await expect(page.getByText('继续整理这个月')).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'monthly-reflection-1440.png'), fullPage: true })

  for (const [key, text] of [['MIND', '本月学习了本地优先架构，并改变了对数据边界的理解。'], ['BODY', '保持规律休息并记录了精力变化。'], ['SPIRIT', '与重要的人进行了坦诚沟通。'], ['VOCATION', '完成了月度复盘功能的开发。']] as const) {
    await page.getByRole('button', { name: key, exact: true }).click()
    await page.getByLabel(`${key} 复盘内容`).fill(text)
    await page.getByRole('button', { name: `保存 ${key}` }).click()
  }
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(page.getByText('100%')).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'monthly-reflection-filled.png'), fullPage: true })

  await page.getByRole('button', { name: 'Events' }).click()
  await page.getByLabel('事件标题').fill('完成 Phase 6')
  await page.getByLabel('事件日期').fill('2026-11-03')
  await page.getByLabel('事件所属维度').selectOption('vocation')
  await page.getByLabel('事件描述').fill('完成真实的本地月度复盘闭环。')
  await page.getByLabel('个人感受').fill('踏实')
  await page.getByLabel('关联项目').fill('Personal AI Profile')
  await page.getByRole('button', { name: '添加事件' }).click()
  await expect(page.getByText('完成 Phase 6')).toBeVisible()
  await page.getByRole('button', { name: 'Goals' }).click()
  await page.getByRole('button', { name: '添加目标' }).click()
  await page.locator('input[aria-label="目标 1"]').fill('完成下一阶段')
  await page.getByRole('button', { name: '保存目标' }).click()

  await page.getByRole('button', { name: 'Summary' }).click()
  await page.getByRole('button', { name: '本地整理摘要' }).click()
  await expect(page.getByLabel('复盘摘要')).not.toHaveValue('')
  await page.getByLabel('复盘摘要').fill('本月完成了本地月度复盘闭环，四个维度均已记录；下个月继续验证历史查询与隐私边界。')
  await page.screenshot({ path: resolve(shots, 'monthly-reflection-summary-edit.png'), fullPage: true })
  await page.getByRole('button', { name: '保存摘要修改' }).click()
  await page.getByRole('button', { name: 'Overview' }).click()
  await page.getByRole('button', { name: '确认正式复盘' }).click()
  await expect(page.getByText('月度复盘已由你确认并进入历史。')).toBeVisible()
  await expect(page.getByText('这份复盘已正式确认')).toBeVisible()
  await page.screenshot({ path: resolve(shots, 'monthly-reflection-confirmed.png'), fullPage: true })

  await page.reload()
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: '月度复盘' }).click()
  await expect(page.getByText('这份复盘已正式确认')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'monthly-reflection-narrow.png'), fullPage: true })
  expect(errors).toEqual([])
})
