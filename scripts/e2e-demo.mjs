import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.getByText('Alex Rivera').waitFor()

await page.getByPlaceholder('Jane Doe').fill('Jordan Lee')
await page.getByPlaceholder('Finance').fill('Engineering')
await page.getByPlaceholder('65000').fill('88000')
await page.getByRole('button', { name: 'Save entry' }).click()

await page.getByText('Jordan Lee').waitFor()
await page.getByText('$160,000').waitFor()

await page.screenshot({ path: '/opt/cursor/artifacts/dpcell-salary-e2e.png', fullPage: true })
console.log('E2E passed: added Jordan Lee, total payroll $160,000')

await browser.close()
