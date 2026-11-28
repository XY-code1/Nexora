import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const shots = resolve(import.meta.dirname, '../../../artifacts/onboarding-qa')

test.beforeAll(() => mkdirSync(shots, { recursive: true }))

test('first run is a standalone, resumable route outside the workspace shell', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await expect(page.getByLabel('NEXORA 首次启动')).toBeVisible()
  await expect(page).toHaveURL(/#\/onboarding\/welcome$/)
  await expect(page.getByRole('button', { name: '概览' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '个人档案', exact: true })).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'first-run-welcome-1440.png'), fullPage: true })

  await page.getByRole('button', { name: /开始使用/ }).click()
  await expect(page).toHaveURL(/#\/onboarding\/vault$/)
  await expect(page.getByRole('heading', { name: '创建或连接个人空间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '概览' })).toHaveCount(0)
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(shots, 'first-run-vault-1440.png'), fullPage: true })

  await page.getByRole('button', { name: /继续使用此 Vault/ }).click()
  await expect(page).toHaveURL(/#\/onboarding\/import$/)
  await expect(page.getByRole('heading', { name: '导入你的第一份知识' })).toBeVisible()
  await expect(page.getByLabel('第 3 步，共 7 步')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(shots, 'first-run-import-1440.png'), fullPage: true })

  await page.setViewportSize({ width: 1024, height: 900 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'first-run-import-1024.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: resolve(shots, 'first-run-import-390.png'), fullPage: true })
  await page.getByRole('button', { name: '暂时跳过导入' }).click()
  await expect(page.getByRole('heading', { name: '你的数据，你的选择' })).toBeVisible()
  expect(errors).toEqual([])
})

test('first-run import creates candidates that enter the shared memory review', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await page.getByRole('button', { name: /开始使用/ }).click()
  await page.getByRole('button', { name: /继续使用此 Vault/ }).click()

  await page.getByLabel('导入内容').fill('首次启动导入的真实候选内容。')
  await page.getByRole('button', { name: '预览' }).click()
  await expect(page.getByText('确认要导入的条目')).toBeVisible()
  await page.getByRole('button', { name: /导入 1 条候选/ }).click()
  await expect(page.getByText('已导入 1 条候选记忆')).toBeVisible()
  await page.getByRole('button', { name: '继续首次设置' }).click()
  await page.getByRole('button', { name: /我明白了，继续/ }).click()
  await page.getByRole('button', { name: '暂时结束建档，进入审核' }).click()

  await expect(page).toHaveURL(/#\/onboarding\/review$/)
  await expect(page.getByText('首次启动导入的真实候选内容。').first()).toBeVisible()
  await page.getByRole('button', { name: /首次启动导入的真实候选内容/ }).click()
  await expect(page.getByText('来源：local-import')).toBeVisible()
})
