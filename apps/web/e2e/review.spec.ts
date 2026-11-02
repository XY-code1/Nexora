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
  await page.getByRole('button', { name: '记忆时间线' }).click()
  await expect(page.getByRole('heading', { name: '记忆时间线' })).toBeVisible()
  await page.getByRole('button', { name: '查看确认摘要' }).click()
  await expect(page.getByText('回答先给结论，再说明原因。')).toBeVisible()
  await page.getByRole('button', { name: '隐私审计' }).click()
  await expect(page.getByRole('heading', { name: '隐私审计' })).toBeVisible()
  await page.getByRole('button', { name: '对话式引导' }).click()
  await expect(page.getByRole('heading', { name: '通过对话建立你的档案' })).toBeVisible()
  await page.getByLabel('你的回答').fill('请称呼我为小明，使用简体中文。')
  await page.getByRole('button', { name: '保存为候选并继续' }).click()
  await expect(page.getByText('回答已保存为候选记忆，确认前不会成为长期事实。')).toBeVisible()
  await page.getByRole('button', { name: '记忆审核' }).click()
  await expect(page.getByRole('heading', { name: 'onboarding-identity' })).toBeVisible()

  await page.getByRole('button', { name: '月度复盘' }).click()
  await page.getByRole('button', { name: '开始本月复盘' }).click()
  const dimensions = [
    ['心智与认知', '改变观点的事实'], ['身体与精力', '睡眠与精力记录'],
    ['意义、关系与价值观', '重要关系与意义'], ['工作、技能与创造', '项目产出与学习'],
  ]
  for (const [index, [title, reflection]] of dimensions.entries()) {
    await expect(page.locator('.assistant-message span')).toHaveText(title)
    await page.getByLabel('你的反思').fill(reflection)
    const saved = page.waitForResponse((response) => response.url().includes('/dimensions/'))
    await page.getByRole('button', { name: '保存并进入下一维度' }).click()
    const savedResponse = await saved
    expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy()
    if (index < dimensions.length - 1) await expect(page.locator('.assistant-message span')).toHaveText(dimensions[index + 1][0])
  }
  await page.getByLabel('复盘摘要').fill('本月完成了阶段目标，也识别了信息不足的部分。')
  await page.getByLabel('未来30天行动计划').fill('每周记录一次事实与进展，月底再次复盘。')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await page.getByRole('button', { name: '确认正式复盘' }).click()
  await expect(page.getByText('Human 3.0复盘已由你确认并进入历史。')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Human 3.0 趋势' })).toBeVisible()
})
