import { test, expect, type Page } from '@playwright/test';

const BASE = ('/' + (process.env.BASE || '').replace(/^[\/]+|[\/]+$/g, '')).replace(/\/$/, '');

/** Wait for an island's post-mount hydration effect to have applied URL/localStorage state
 * (see the `data-hydrated` attribute each island sets once its mount effect has run). Interacting
 * with an island before this can hit stale DOM from before Preact finishes hydrating. */
async function hydrated(page: Page, testId: string) {
  const tool = page.getByTestId(testId);
  await expect(tool).toHaveAttribute('data-hydrated', 'true', { timeout: 10_000 });
  return tool;
}

test.describe('final grade calculator', () => {
  test('computes and shows a verdict', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/`);
    const tool = await hydrated(page, 'final-grade');
    await page.locator('#fg-current').fill('88');
    await page.locator('#fg-weight').fill('30');
    await page.locator('#fg-target').fill('90');
    await expect(tool.locator('.result__value')).toHaveText('94.7%');
    await expect(tool.locator('.result__verdict')).toContainText('94.7');
  });

  test('share link restores the exact same result (default values)', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?c=88&w=30&t=90`);
    const tool = await hydrated(page, 'final-grade');
    await expect(tool.locator('.result__value')).toHaveText('94.7%');
    await expect(page.locator('#fg-current')).toHaveValue('88');
    await expect(page.locator('#fg-weight')).toHaveValue('30');
  });

  // Regression for audit P0-1: every island used to read the URL/localStorage inside its initial
  // useState(), which the server never sees — hydration then kept the SSR-default DOM (inputs,
  // tabs, results) while the app's own state silently held the real, different values. The old
  // share-link tests above only ever used URLs equal to the defaults, so they passed either way.
  test('a NON-default share link updates the inputs and result after hydration, not just the state', async ({ page }) => {
    await page.goto(`${BASE}/?c=70&w=40&t=80`);
    const tool = await hydrated(page, 'final-grade');
    await expect(page.locator('#fg-current')).toHaveValue('70');
    await expect(page.locator('#fg-weight')).toHaveValue('40');
    await expect(page.locator('#fg-target')).toHaveValue('80');
    // (target - current*(1-w))/w = (80 - 70*0.6)/0.4 = 95
    await expect(tool.locator('.result__value')).toHaveText('95%');
    await expect(tool.locator('.result__verdict')).toContainText('95');
  });

  test('a two-part share link selects the right tab and shows only that section\'s fields', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?m=two&c=80&w1=20&w2=20&t=85&s1=90`);
    const tool = await hydrated(page, 'final-grade');
    await expect(tool.locator('.tool__tab[aria-selected="true"]')).toHaveText('Two-part final');
    await expect(page.locator('#fg-current2')).toHaveValue('80');
    await expect(page.locator('#fg-w1')).toHaveValue('20');
    await expect(page.locator('#fg-w2')).toHaveValue('20');
    await expect(page.locator('#fg-p1')).toHaveValue('90');
    // part2 needed = (target - current*rest - part1*w1)/w2 = (85 - 80*0.6 - 90*0.2)/0.2 = 95
    await expect(tool.locator('.result__value')).toHaveText('95%');
  });

  test('a lowest-test share link restores the tab, the test list and the result', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?m=lowest&x=70,80,90&t=85`);
    const tool = await hydrated(page, 'final-grade');
    await expect(tool.locator('.tool__tab[aria-selected="true"]')).toHaveText('Final replaces lowest test');
    await expect(page.locator('#fg-tests')).toHaveValue('70, 80, 90');
    await expect(tool.locator('.result__value')).not.toHaveText('');
    await expect(tool.locator('.result__label')).not.toContainText('Current grade');
  });

  test('typing "0.5" into a weight field produces 0.5, not 0.015 (regression for audit P2-1)', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/`);
    await hydrated(page, 'final-grade');
    const weight = page.locator('#fg-weight');
    await weight.fill('');
    await weight.pressSequentially('0.5', { delay: 30 });
    await expect(weight).toHaveValue('0.5');
  });

  // Regression for audit 2's N-1: the "final replaces lowest test" tab only parsed its tests field
  // on blur, so the result kept showing the old, stale numbers while typing.
  test('the lowest-test result updates live while typing, without blurring the field', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?m=lowest`);
    const tool = await hydrated(page, 'final-grade');
    const before = await tool.locator('.result__value').textContent();
    await page.locator('#fg-tests').pressSequentially('50, 60, 95', { delay: 20 });
    // No blur — the result should already reflect the new tests.
    await expect(tool.locator('.result__value')).not.toHaveText(before ?? '');
  });

  test('two-part weights over 100% show a validation message instead of a wrong percentage', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?m=two`);
    const tool = await hydrated(page, 'final-grade');
    await page.locator('#fg-w1').fill('70');
    await page.locator('#fg-w1').blur();
    await page.locator('#fg-w2').fill('60');
    await page.locator('#fg-w2').blur();
    await expect(tool.getByRole('alert')).toContainText(/more than 100%/i);
  });

  test('a secured result never shows a negative needed score', async ({ page }) => {
    await page.goto(`${BASE}/final-grade-calculator/?c=100&w=25&t=0`);
    const tool = await hydrated(page, 'final-grade');
    await expect(tool.locator('.result__value')).toHaveText('0%');
  });
});

test.describe('weighted grade calculator', () => {
  test('adding a category and an assignment updates the current grade', async ({ page }) => {
    await page.goto(`${BASE}/grade-calculator/`);
    const tool = await hydrated(page, 'grade-book');
    const categories = tool.locator('.category');
    await expect(categories).toHaveCount(3);

    await tool.getByRole('button', { name: '+ Add category' }).click();
    await expect(categories).toHaveCount(4);

    const last = categories.last();
    await last.locator('input[id^="cat-name-"]').fill('Quizzes');
    await last.locator('input[id^="cat-weight-"]').fill('100');
    for (let i = 0; i < 3; i++) {
      await categories.nth(i).locator('input[id^="cat-weight-"]').fill('0');
    }
    await last.getByRole('button', { name: '+ Add grade' }).click();
    const item = last.locator('.item-row').last();
    await item.locator('input[aria-label="Score earned"]').fill('80');
    await item.locator('input[aria-label="Points possible"]').fill('100');

    await expect(tool.locator('.summary-strip__item strong').first()).toHaveText('80%');
  });

  // Regression for audit P1-4: reloading a saved course (whose state is mirrored into the URL for
  // shareability) used to be indistinguishable from opening someone else's shared link, so it
  // always spawned a fresh 'draft' — losing the term and creating a duplicate on the next Save.
  test('reloading a saved course does not duplicate it or drop its term', async ({ page }) => {
    await page.goto(`${BASE}/grade-calculator/`);
    const tool = await hydrated(page, 'grade-book');
    await page.locator('#gb-name').fill('Bio 101');
    await page.locator('#gb-term').fill('Fall');
    await tool.getByRole('button', { name: 'Save course' }).click();
    await expect(tool.locator('.course-tab[aria-selected="true"]')).toHaveText('Bio 101');

    await page.reload();
    const reloaded = await hydrated(page, 'grade-book');
    await expect(page.locator('#gb-name')).toHaveValue('Bio 101');
    await expect(page.locator('#gb-term')).toHaveValue('Fall');
    await expect(reloaded.locator('.course-tab[aria-selected="true"]')).toHaveText('Bio 101');
    // Exactly one saved-course tab named "Bio 101" — not two.
    await expect(reloaded.locator('.course-tab', { hasText: 'Bio 101' })).toHaveCount(1);

    await reloaded.getByRole('button', { name: 'Save course' }).click();
    await expect(reloaded.locator('.course-tab', { hasText: 'Bio 101' })).toHaveCount(1);
  });

  // Regression for audit 2's N-2: reloading after editing a saved course used to silently discard
  // the edit (the mount effect always preferred the saved course over the URL's edited state).
  test('reloading after an unsaved edit keeps the edit instead of silently discarding it', async ({ page }) => {
    await page.goto(`${BASE}/grade-calculator/`);
    const tool = await hydrated(page, 'grade-book');
    await page.locator('#gb-name').fill('Bio 101');
    await tool.getByRole('button', { name: 'Save course' }).click();

    const midterm = tool.locator('.category').nth(1).locator('input[aria-label="Score earned"]').first();
    await midterm.fill('70');
    await midterm.blur();
    const editedGrade = await tool.locator('.summary-strip__item strong').first().textContent();
    // The edit is written to the URL on a 250ms debounce (see useDebouncedEffect) — wait for it,
    // otherwise reloading races the write and lands on the last-saved (unedited) URL.
    await expect.poll(() => page.evaluate(() => location.search)).toContain('Midterm%3A70');

    await page.reload();
    const reloaded = await hydrated(page, 'grade-book');
    await expect(reloaded.locator('.category').nth(1).locator('input[aria-label="Score earned"]').first()).toHaveValue('70');
    await expect(reloaded.locator('.summary-strip__item strong').first()).toHaveText(editedGrade ?? '');
  });

  test('deleting a saved course asks for confirmation', async ({ page }) => {
    await page.goto(`${BASE}/grade-calculator/`);
    const tool = await hydrated(page, 'grade-book');
    await page.locator('#gb-name').fill('Temp Course');
    await tool.getByRole('button', { name: 'Save course' }).click();
    await expect(tool.locator('.course-tab[aria-selected="true"]')).toHaveText('Temp Course');

    let dialogSeen = false;
    page.once('dialog', (d) => {
      dialogSeen = true;
      void d.dismiss();
    });
    await tool.getByRole('button', { name: 'Delete course' }).click();
    await expect.poll(() => dialogSeen).toBe(true);
    // Dismissed — the course is still there.
    await expect(tool.locator('.course-tab[aria-selected="true"]')).toHaveText('Temp Course');
  });
});

test.describe('GPA calculator', () => {
  test('three courses produce the correct GPA', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/`);
    const tool = await hydrated(page, 'gpa-calc');
    await expect(tool.locator('.summary-strip__item strong').first()).toHaveText('3.63');
  });

  test('share link restores the same GPA (default values)', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/?s=us-4-0&c=A:3,B%2B:4,A-:3`);
    const tool = await hydrated(page, 'gpa-calc');
    await expect(tool.locator('.summary-strip__item strong').first()).toHaveText('3.63');
  });

  // Regression for audit P0-1: a 5-course, non-default share link used to hydrate with the
  // default 3-course starter data still visible (wrong selects, broken row count) while the GPA
  // shown was silently computed from the URL.
  test('a 5-course share link shows the actual grades in the selects, not the SSR defaults', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/?s=us-4-0&c=A:3,B:3,C:3,A-:4,B%2B:2&pg=3.2&pc=30`);
    const tool = await hydrated(page, 'gpa-calc');
    const rows = tool.locator('.item-row--gpa');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1).locator('select[aria-label="Grade"]')).toHaveValue('B');
    await expect(rows.nth(2).locator('select[aria-label="Grade"]')).toHaveValue('C');
    // credits: 3+3+3+4+2 = 15, quality points: 4*3+3*3+2*3+3.7*4+3.3*2 = 12+9+6+14.8+6.6 = 48.4 -> 3.227
    await expect(tool.locator('.summary-strip__item strong').first()).toHaveText('3.227');
  });

  // Regression for audit P1-2: switching to a scale that doesn't share every grade used to
  // silently drop those courses from the GPA (blank selects, wrong lower credit count, no warning).
  test('switching grading scale remaps courses instead of silently dropping them', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/`);
    const tool = await hydrated(page, 'gpa-calc');
    await expect(tool.getByText('3 of 3 courses counted')).toBeVisible();
    await page.locator('#gpa-scale').selectOption('mit-5-0');
    // Every course should still resolve to a valid, visible grade on the new scale.
    const grades = tool.locator('select[aria-label="Grade"]');
    for (let i = 0; i < (await grades.count()); i++) {
      const v = await grades.nth(i).inputValue();
      expect(v, `row ${i} grade`).not.toBe('');
    }
    await expect(tool.getByText(/of 3 courses counted/)).toBeVisible();
    await expect(tool.locator('.summary-strip__item strong').first()).not.toHaveText('—');
  });

  // Regression for audit 2's N-3: the post-mount effect always wrote the URL, even on a bare
  // reload with no edits, and the next reload then decoded that as an anonymous share — renaming
  // the saved semester "Shared semester" and duplicating it on the next Save.
  test('a saved semester survives repeated reloads without being renamed or duplicated', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/`);
    const tool = await hydrated(page, 'gpa-calc');
    await page.locator('#gpa-name').fill('Spring');
    await tool.getByRole('button', { name: 'Save semester' }).click();
    await expect(tool.locator('.course-tab[aria-selected="true"]')).toHaveText('Spring');

    await page.reload();
    let reloaded = await hydrated(page, 'gpa-calc');
    await expect(page.locator('#gpa-name')).toHaveValue('Spring');
    await expect(reloaded.locator('.course-tab[aria-selected="true"]')).toHaveText('Spring');

    await page.reload();
    reloaded = await hydrated(page, 'gpa-calc');
    await expect(page.locator('#gpa-name')).toHaveValue('Spring');
    await expect(reloaded.locator('.course-tab', { hasText: 'Spring' })).toHaveCount(1);
    await expect(reloaded.locator('.course-tab', { hasText: 'Shared semester' })).toHaveCount(0);

    await reloaded.getByRole('button', { name: 'Save semester' }).click();
    await expect(reloaded.locator('.course-tab', { hasText: 'Spring' })).toHaveCount(1);
  });

  test('the inverted Germany scale and the descriptive France scale are not offered in the averager', async ({ page }) => {
    await page.goto(`${BASE}/gpa-calculator/`);
    await hydrated(page, 'gpa-calc');
    const options = await page.locator('#gpa-scale option').allTextContents();
    expect(options.join(' ')).not.toMatch(/Germany/i);
    expect(options.join(' ')).not.toMatch(/France/i);
  });
});

test.describe('GPA planner', () => {
  test('computes the required average for the spec example', async ({ page }) => {
    await page.goto(`${BASE}/gpa-planner/?g=3.1&c=45&t=3.5&n=30`);
    const tool = await hydrated(page, 'gpa-planner');
    await expect(tool.locator('.result__value')).toHaveText('4.1');
  });

  test('a share link restores the inputs after hydration, not the SSR defaults', async ({ page }) => {
    await page.goto(`${BASE}/gpa-planner/?g=2.5&c=60&t=3&n=30`);
    const tool = await hydrated(page, 'gpa-planner');
    await expect(page.locator('#pl-gpa')).toHaveValue('2.5');
    await expect(page.locator('#pl-credits')).toHaveValue('60');
    await expect(page.locator('#pl-target')).toHaveValue('3');
    // (3*(60+30) - 2.5*60)/30 = (270-150)/30 = 4
    await expect(tool.locator('.result__value')).toHaveText('4');
  });
});
