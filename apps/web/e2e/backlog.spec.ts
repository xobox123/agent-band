import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { seedAgent, seedTask } from './helpers.ts';

// Wide enough to show the Backlog and Failed / Denied columns together for dragging.
test.use({ viewport: { width: 2800, height: 1000 } });

/** A disabled agent makes the worker deny the task, which lands in the Failed / Denied column. */
async function deniedTask(request: APIRequestContext, slug: string, title: string) {
  const agent = await seedAgent(request, slug, false);
  const task = await seedTask(request, title, agent.id);
  const start = await request.post(`/api/v1/tasks/${task.id}/start`, { data: {} });
  expect(start.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/v1/tasks/${task.id}`)).json()) as { status: string }).status,
    )
    .toBe('denied');
  return task;
}

const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('moves a denied task back to the backlog from the card menu', async ({ page, request }) => {
  const task = await deniedTask(request, 'menu', 'Menu restore');
  await page.goto('/');
  const card = column(page, 'Failed / Denied').getByRole('article', { name: new RegExp(`^${task.key} `) });
  await card.getByRole('button', { name: `Actions for ${task.key}` }).click();
  await page.getByRole('menuitem', { name: 'Move to backlog' }).click();
  await expect(
    column(page, 'Backlog').getByRole('article', { name: new RegExp(`^${task.key} `) }),
  ).toBeVisible();
  await expect(
    column(page, 'Failed / Denied').getByRole('article', { name: new RegExp(`^${task.key} `) }),
  ).toHaveCount(0);
});

test('moves a denied task back to the backlog by dragging it', async ({ page, request }) => {
  const task = await deniedTask(request, 'drag', 'Drag restore');
  await page.goto('/');
  const card = column(page, 'Failed / Denied').getByRole('article', { name: new RegExp(`^${task.key} `) });
  await card.dragTo(column(page, 'Backlog'));
  await expect(
    column(page, 'Backlog').getByRole('article', { name: new RegExp(`^${task.key} `) }),
  ).toBeVisible();
  const reloaded = await request.get(`/api/v1/tasks/${task.id}`);
  expect(((await reloaded.json()) as { status: string }).status).toBe('draft');
});
