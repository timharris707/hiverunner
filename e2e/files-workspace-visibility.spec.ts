import { expect, test } from "@playwright/test";

const HIDDEN_WORKSPACE_PATTERN = /(oc-stress|stress-agent|workspace-(tmp|temp|test|generated))/i;

test.describe("Files workspace visibility", () => {
  test("api/files/workspaces excludes stress and generated workspaces", async ({ request }) => {
    const response = await request.get("/api/files/workspaces");
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      workspaces?: Array<{ id?: string }>;
    };

    const ids = (body.workspaces ?? []).map((workspace) => String(workspace.id ?? ""));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("workspace");

    for (const id of ids) {
      expect(id).not.toMatch(HIDDEN_WORKSPACE_PATTERN);
    }
  });

  test("/files UI does not render stress workspace entries", async ({ page }) => {
    await page.goto("/files");
    await expect(page.getByText("Workspaces", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Main Workspace/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/oc-stress|stress-agent/i)).toHaveCount(0);
  });
});
