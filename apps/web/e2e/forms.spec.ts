import { expect, test } from '@playwright/test';
import { SHOTS, seedAgent } from './helpers.ts';

test.describe('New task form', () => {
  test('a relative work directory turns the field red with the message under it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByText('Advanced: use an existing project folder').click();
    const input = dialog.getByLabel(/^Project folder/);
    await input.fill('relative/path');
    await input.blur();

    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveClass(/is-invalid/);
    const message = dialog.locator('[data-field="workDir"] .field-error');
    await expect(message).toHaveText(/absolute path/);
    expect(await input.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(
      await dialog.getByLabel(/^Title/).evaluate((el) => getComputedStyle(el).borderColor),
    );
    const inputBox = await input.boundingBox();
    const messageBox = await message.boundingBox();
    expect(messageBox?.y ?? 0).toBeGreaterThan((inputBox?.y ?? 0) + (inputBox?.height ?? 0) - 1);
    await expect(dialog.locator('p.form-error')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/ux1-workdir-client.png` });
  });

  test('submitting without an agent marks the agent select', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel(/^Title/).fill('No agent');
    await dialog.getByLabel(/^Prompt/).fill('Do it');
    await dialog.getByRole('button', { name: 'Add to backlog' }).click();

    const agent = dialog.getByLabel(/^Agent/);
    await expect(agent).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.locator('[data-field="agentId"] .field-error')).toHaveText('Select an agent.');
    await expect(dialog.getByRole('button', { name: 'Missing: Agent' })).toBeVisible();
    await expect(dialog.locator('p.form-error')).toHaveCount(0);
  });

  test('a server rejection of the work directory shows under that field', async ({ page, request }) => {
    const agent = await seedAgent(request, 'policy');
    await page.goto('/');
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel(/^Title/).fill('Outside');
    await dialog.getByLabel(/^Prompt/).fill('Do it');
    await dialog.getByLabel(/^Agent/).selectOption({ label: agent.name });
    await dialog.getByText('Advanced: use an existing project folder').click();
    const input = dialog.getByLabel(/^Project folder/);
    await input.fill('/etc/ab-e2e-outside');
    await dialog.getByRole('button', { name: 'Add to backlog' }).click();

    await expect(input).toHaveAttribute('aria-invalid', 'true');
    const message = dialog.locator('[data-field="workDir"] .field-error');
    await expect(message).toContainText('/etc/ab-e2e-outside');
    await expect(message).toContainText('outside the directories allowed');
    await expect(dialog.locator('p.form-error')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/ux1-workdir-server.png` });

    await input.fill('');
    await expect(message).toHaveCount(0);
  });
});

test('the New schedule dialog closes with the x button', async ({ page }) => {
  await page.goto('/#/schedules');
  await page
    .getByRole('button', { name: /New schedule|Create schedule/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'New schedule' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});
