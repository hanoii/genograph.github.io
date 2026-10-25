import { test, expect } from '@playwright/test';

const LOCAL = 'http://127.0.0.1:3456/';
const HOSTED = 'http://127.0.0.1:4173/';

async function openApp(page, url) {
  await page.addInitScript(() => localStorage.setItem('ft_welcomed', '1'));
  await page.goto(url);
  await expect(page.locator('.card').first()).toBeVisible();
}

async function createTreeWithPerson(page, treeName, personName) {
  await page.locator('#treeBtn').click();
  await page.locator('#tmNew').click();
  await expect(page.locator('#promptDialog')).toBeVisible();
  await page.locator('#pdInput').fill(treeName);
  await page.locator('#pdOk').click();
  await page.locator('#emptyAction').click();
  await expect(page.locator('#addDialog')).toBeVisible();
  await page.locator('#apName').fill(personName);
  await page.locator('#apOk').click();
  await expect(page.locator('.card', { hasText: personName })).toBeVisible();
  await expect(page.locator('#saveStatus')).toContainText('Saved', { timeout: 5_000 });
}

test('local app creates, edits, reloads, exports, and imports a tree', async ({ page }) => {
  await openApp(page, LOCAL);
  const treeName = `E2E local ${Date.now()}`;
  const personName = 'Ada Browser Test';
  await createTreeWithPerson(page, treeName, personName);

  const card = page.locator('.card', { hasText: personName });
  await card.focus();
  await card.press('Enter');
  await expect(page.locator('#panel')).toBeVisible();
  await page.locator('#pf-occupation').fill('Reliability engineer');
  await expect(page.locator('#saveStatus')).toContainText('Saved', { timeout: 5_000 });

  await page.reload();
  await expect(page.locator('.card', { hasText: personName })).toBeVisible();
  await page.locator('.card', { hasText: personName }).click();
  await expect(page.locator('#pf-occupation')).toHaveValue('Reliability engineer');

  await page.locator('#treeBtn').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#tmExport').click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();

  await page.locator('#treeBtn').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#tmImport').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(exportedPath);
  await expect(page.locator('.card', { hasText: personName })).toBeVisible();
  await expect(page.locator('#snackbar')).toContainText('Imported');
});

test('hosted IndexedDB mode persists edits across reloads', async ({ page }) => {
  await openApp(page, HOSTED);
  const treeName = `E2E browser ${Date.now()}`;
  const personName = 'IndexedDB Person';
  await createTreeWithPerson(page, treeName, personName);
  await page.reload();
  await expect(page.locator('.card', { hasText: personName })).toBeVisible();
  await page.locator('#treeBtn').click();
  await expect(page.locator('#tmStorePath')).toContainText('Stored in this browser');
});

test('a spouse link can be removed without deleting either person', async ({ page }) => {
  await openApp(page, HOSTED);
  await createTreeWithPerson(page, `E2E unlink ${Date.now()}`, 'Unlink Person');
  await page.locator('.card', { hasText: 'Unlink Person' }).click();
  await page.locator('#panel [data-add="spouse"]').click();
  await page.locator('#apName').fill('Mistaken Spouse');
  await page.locator('#apOk').click();
  await page.locator('.card', { hasText: 'Unlink Person' }).click();

  await page.locator('#panel [data-unlink="spouse"]').click();
  await expect(page.locator('#confirmDialog')).toBeVisible();
  await page.locator('#cdOk').click();
  await expect(page.locator('#panel .chip[data-go]', { hasText: 'Mistaken Spouse' })).toHaveCount(0);
  await expect(page.locator('#saveStatus')).toContainText('Saved', { timeout: 5_000 });

  await page.reload();
  await page.locator('.card', { hasText: 'Unlink Person' }).click();
  await expect(page.locator('#panel .chip[data-go]', { hasText: 'Mistaken Spouse' })).toHaveCount(0);
  await expect(page.locator('#stats')).toContainText('2 people');
});

test('an edit made during an in-flight save is persisted by a later generation', async ({ page }) => {
  let writes = 0;
  let releaseFirst;
  let sawFirst;
  const firstSeen = new Promise(resolve => { sawFirst = resolve; });
  const firstRelease = new Promise(resolve => { releaseFirst = resolve; });
  await page.route('**/api/trees/*', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (writes === 1) { sawFirst(); await firstRelease; }
    }
    await route.continue();
  });
  await openApp(page, LOCAL);
  await page.locator('.card').first().click();
  const occupation = page.locator('#pf-occupation');
  await occupation.fill('First revision');
  await firstSeen;
  await occupation.fill('Second revision');
  releaseFirst();
  await expect.poll(() => writes, { timeout: 6_000 }).toBe(2);
  await expect(page.locator('#saveStatus')).toContainText('Saved');
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('#pf-occupation')).toHaveValue('Second revision');
});

test('a failed save blocks a tree transition and remains visible', async ({ page }) => {
  await page.route('**/api/trees/*', async route => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await openApp(page, LOCAL);
  const originalTree = await page.locator('#treeBtnName').textContent();
  await page.locator('.card').first().click();
  await page.locator('#pf-occupation').fill('Unsaved transition test');
  await page.locator('#treeBtn').click();
  await page.locator('#tmNew').click();
  await expect(page.locator('#promptDialog')).not.toBeVisible();
  await expect(page.locator('#saveStatus')).toContainText('Save failed');
  await expect(page.locator('#treeBtnName')).toHaveText(originalTree);
});

test('core tree controls expose keyboard and state semantics', async ({ page }) => {
  await openApp(page, HOSTED);
  const card = page.getByRole('treeitem').first();
  await expect(card).toHaveAttribute('tabindex', '0');
  await card.focus();
  await card.press('Enter');
  await expect(card).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#segFull')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#saveStatus')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#searchInput')).toHaveAttribute('role', 'combobox');
});
