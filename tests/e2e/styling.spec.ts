import { expect, test } from "@playwright/test";

test("loads Tailwind utilities and uses the desktop start-screen layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const livePanel = page.getByRole("region", { name: "Live interview" });
  const panelGrid = livePanel.locator("..");

  await expect(livePanel).toBeVisible();
  await expect
    .poll(() => panelGrid.evaluate((element) => getComputedStyle(element).display))
    .toBe("grid");
  await expect
    .poll(() =>
      panelGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
    )
    .toBe(2);
  await expect
    .poll(() => livePanel.evaluate((element) => getComputedStyle(element).borderRadius))
    .not.toBe("0px");
});
