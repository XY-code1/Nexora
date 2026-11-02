import { expect, test } from '@playwright/test'

test('审核候选记忆：编辑后确认', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByLabel('本地启动令牌').fill('e2e-token')
  await page.getByRole('button', { name: '连接审核空间' }).click()
  await expect(page.getByRole('heading', { name: '回答风格' })).toBeVisible()
  await page.getByLabel('记忆内容').fill('回答先给结论，再说明原因。')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('修改已保存。')).toBeVisible()
  await page.getByRole('button', { name: '确认记忆' }).click()
  await expect(page.getByText('记忆已确认。')).toBeVisible()
  await expect(page.getByText('暂时没有候选记忆')).toBeVisible()
})
