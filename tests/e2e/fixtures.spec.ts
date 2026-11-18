import { expect, test } from '@playwright/test'

test('static catalog is in the first payload', async ({ page }) => {
  await page.goto('/pages/static')
  await expect(page.locator('#catalog li').first()).toHaveText('Copper kettle')
})

test('async catalog appears after the timer and not before', async ({ page }) => {
  await page.goto('/pages/async')
  await expect(page.locator('#catalog')).toHaveCount(0)
  await expect(page.locator('#catalog')).toHaveText('Copper kettle, Field notebook, Brass compass', { timeout: 4_000 })
})

test('fingerprint page publishes webdriver without hiding it', async ({ page }) => {
  await page.goto('/pages/fingerprint')
  await page.locator('#fp-json[data-ready="1"]').waitFor()
  const body = JSON.parse(await page.locator('#fp-json').innerText())
  expect(typeof body.webdriver).toBe('boolean')
  expect(body.userAgent).toContain('Mozilla')
})

test('gate fixture renders the teaser payload', async ({ page }) => {
  await page.goto('/pages/gate')
  await expect(page.locator('#gate-result')).toHaveText('TEASER_ONLY')
})

test('robots.txt disallows /private and the server still answers if asked', async ({ request }) => {
  const robots = await request.get('/robots.txt')
  expect(await robots.text()).toContain('Disallow: /private')
  const secret = await request.get('/private/secret')
  expect(secret.status()).toBe(200)
})

test('status pages return the advertised code', async ({ request }) => {
  expect((await request.get('/pages/status/403')).status()).toBe(403)
  expect((await request.get('/pages/status/429')).status()).toBe(429)
  expect((await request.get('/pages/status/500')).status()).toBe(500)
})
