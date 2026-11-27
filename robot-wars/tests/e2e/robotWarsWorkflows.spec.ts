import { expect, test, type Page } from "@playwright/test";

function createBinaryBoxStlPayload(): Buffer {
  const triangles = [
    [[-200, -50, -150], [200, -50, -150], [200, 50, -150]],
    [[-200, -50, -150], [200, 50, -150], [-200, 50, -150]],
    [[-200, -50, 150], [200, -50, 150], [200, 50, 150]],
    [[-200, -50, 150], [200, 50, 150], [-200, 50, 150]],
    [[-200, -50, -150], [200, -50, -150], [200, -50, 150]],
    [[-200, -50, -150], [200, -50, 150], [-200, -50, 150]],
    [[-200, 50, -150], [-200, 50, 150], [200, 50, 150]],
    [[-200, 50, -150], [200, 50, 150], [200, 50, -150]],
    [[-200, -50, -150], [-200, -50, 150], [-200, 50, 150]],
    [[-200, -50, -150], [-200, 50, 150], [-200, 50, -150]],
    [[200, -50, -150], [200, 50, -150], [200, 50, 150]],
    [[200, -50, -150], [200, 50, 150], [200, -50, 150]],
  ] as const;

  const byteLength = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const [a, b, c] of triangles) {
    // Normal left 0 (parser recomputes geometric normals cleanly)
    offset += 12;
    for (const vertex of [a, b, c]) {
      view.setFloat32(offset, vertex[0], true);
      view.setFloat32(offset + 4, vertex[1], true);
      view.setFloat32(offset + 8, vertex[2], true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return Buffer.from(buffer);
}

async function startAndConfirmFoundation(page: Page) {
  const startBtn = page.getByRole("button", { name: "Start Foundation Build" });
  const confirmBtn = page.getByRole("button", { name: "Confirm Foundation" });
  await expect(startBtn.or(confirmBtn)).toBeVisible();
  if (await startBtn.isVisible()) {
    await startBtn.click();
  }
  await confirmBtn.click();
}

async function assembleDrivableTwoWheelRobot(page: Page) {
  await startAndConfirmFoundation(page);

  await page.getByRole("button", { name: /3\s*Battery/i }).click();
  await page.getByRole("button", { name: /Install Battery/i }).click();

  await page.getByRole("button", { name: /4\s*Controller/i }).click();
  await page.getByRole("button", { name: /Install Controller/i }).click();

  await page.getByRole("button", { name: /5\s*Motors/i }).click();
  await page.locator(".motor-list button").first().click();
  const mountZones = page.locator(".mount-zone-list button");
  await mountZones.nth(0).click();
  await page.getByRole("button", { name: "Add Motor" }).click();
  await mountZones.nth(1).click();
  await page.getByRole("button", { name: "Add Motor" }).click();

  await page.getByRole("button", { name: /6\s*Wheels/i }).click();
  await page.locator(".wheel-list button").first().click();
  const wheelMotors = page.locator(".wheel-motor-list button");
  await wheelMotors.nth(0).click();
  await page.getByRole("button", { name: "Mount Wheel" }).click();
  await wheelMotors.nth(1).click();
  await page.getByRole("button", { name: "Mount Wheel" }).click();

  await page.getByRole("button", { name: "Continue to Drivetrain" }).click();
  await expect(page.locator(".drivetrain-status").first()).toContainText(
    "Configuration ready"
  );
}

test.describe("Robot Wars End-to-End Critical Workflows", () => {
  test("1280px responsive header, health button across workspaces, and ARIA tablist keyboard navigation", async ({
    page,
  }) => {
    await page.goto("/");

    const layoutMetrics = await page.evaluate(() => {
      const docOverflow =
        document.documentElement.scrollWidth > window.innerWidth;
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".topbar-actions button")
      );
      const clipped = buttons.some((btn) => {
        const rect = btn.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0 || rect.right > window.innerWidth + 1;
      });
      return { docOverflow, clipped, count: buttons.length };
    });

    expect(layoutMetrics.docOverflow).toBe(false);
    expect(layoutMetrics.clipped).toBe(false);
    expect(layoutMetrics.count).toBeGreaterThanOrEqual(7);

    // Header health button opens Validate tab in Workshop
    await page.locator("button.workshop-health-btn").click();
    await expect(page.locator("#workshop-tab-validation")).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Switch to Electrical workspace and verify Header health button opens Electrical Diagnostics
    await page.getByRole("button", { name: /Electrical \(0\)/i }).click();
    await expect(page.locator("#electrical-tab-wiring")).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.locator("button.workshop-health-btn").click();
    await expect(page.locator("#electrical-tab-diagnostics")).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // ARIA tablist keyboard navigation (Home -> ArrowRight)
    await page.locator("#electrical-tab-diagnostics").focus();
    await page.keyboard.press("Home");
    await expect(page.locator("#electrical-tab-wiring")).toBeFocused();
    await expect(page.locator("#electrical-tab-wiring")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#electrical-tab-inspector")).toBeFocused();
    await expect(page.locator("#electrical-tab-inspector")).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("destructive Reset confirmation modal protects active build on Cancel/Escape and resets on Confirm", async ({
    page,
  }) => {
    await page.goto("/");
    await startAndConfirmFoundation(page);
    const batteryStep = page.getByRole("button", { name: /3\s*Battery/i });
    await expect(batteryStep).toBeEnabled();

    // Reset button opens accessible alertdialog; Escape cancels cleanly
    await page.getByRole("button", { name: "Reset" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(batteryStep).toBeEnabled();

    // Cancel button also aborts reset
    await page.getByRole("button", { name: "Reset" }).click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(batteryStep).toBeEnabled();

    // Confirming resets back to unconfirmed new-build state
    await page.getByRole("button", { name: "Reset" }).click();
    await dialog.getByRole("button", { name: "Start New Build" }).click();
    await expect(dialog).toBeHidden();
    await expect(batteryStep).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Confirm Foundation" })
    ).toBeVisible();
  });

  test("imports STL foundation file through UI file input and confirms custom geometry", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start Foundation Build" }).click();
    await page
      .getByRole("tab", { name: "Import Foundation (STL)" })
      .click();

    await page
      .locator('input[aria-label="Choose STL file"]')
      .setInputFiles({
        name: "e2e-wedge.stl",
        mimeType: "application/octet-stream",
        buffer: createBinaryBoxStlPayload(),
      });

    const useButton = page.getByRole("button", { name: "Use Imported STL" });
    await expect(useButton).toBeEnabled();
    await useButton.click();

    await expect(page.locator("footer.statusbar")).toContainText("OBJECTS: 1");
    await page.getByRole("button", { name: "Confirm Foundation" }).click();
    await expect(
      page.getByRole("button", { name: /2\s*Structure/i })
    ).toBeEnabled();
  });

  test("exports project JSON, recovers autosave across page reload, and imports project file", async ({
    page,
  }) => {
    await page.goto("/");

    await startAndConfirmFoundation(page);
    const nameInput = page.locator('input[aria-label="Project name"]');
    await nameInput.fill("E2E Arena Mk5");
    await page.getByRole("button", { name: /3\s*Battery/i }).click();
    await page.getByRole("button", { name: /Install Battery/i }).click();

    // Wait briefly for debounced autosave or trigger save export immediately
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save Project" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(".robotwars.json");

    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // Reload and verify Recover Autosave restores build (ensure autosave debounce settles first if needed)
    await page.waitForTimeout(450);
    await page.reload();
    const recoverBtn = page.getByRole("button", { name: "Recover Autosave" });
    await expect(recoverBtn).toBeVisible();
    await recoverBtn.click();
    await expect(page.locator('input[aria-label="Project name"]')).toHaveValue(
      "E2E Arena Mk5"
    );

    // Verify Load Project file upload restores exported archive on fresh state
    await page.getByRole("button", { name: "Reset" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Start New Build" })
      .click();
    await expect(page.locator('input[aria-label="Project name"]')).not.toHaveValue(
      "E2E Arena Mk5"
    );

    await page
      .locator('input[aria-label="Import project file"]')
      .setInputFiles(filePath!);
    await expect(page.locator('input[aria-label="Project name"]')).toHaveValue(
      "E2E Arena Mk5"
    );
  });

  test("assembles robot, enters Simulation & Visual Program Builder, verifies Space button focus safety & debugger controls", async ({
    page,
  }) => {
    await page.goto("/");
    await assembleDrivableTwoWheelRobot(page);

    await page.getByRole("button", { name: "Test Robot" }).click();
    const startSimBtn = page.getByRole("button", { name: "Start Simulation" });
    await expect(startSimBtn).toBeVisible();

    // Pressing Space while a <button> is focused must activate the button, NOT trigger Space e-stop interception
    await startSimBtn.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    // Switch to Program Builder view and test debugger controls
    await page
      .getByRole("button", { name: /Program Builder/i })
      .click();
    const runBtn = page.getByRole("button", { name: /▶ Run Routine/i });
    const stepBtn = page.getByRole("button", { name: /⏭ Step/i });
    const stopBtn = page.getByRole("button", { name: /■ Stop/i });

    await expect(runBtn).toBeVisible();
    await stepBtn.click();
    await expect(page.getByRole("button", { name: /▶ Resume/i })).toBeVisible();
    await stopBtn.click();

    await page.getByRole("button", { name: /Back to Workshop/i }).click();
    await expect(page.getByRole("button", { name: "Save Project" })).toBeVisible();
  });
});
