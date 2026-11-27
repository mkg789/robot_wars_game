import { describe, expect, it, vi } from "vitest";
import {
  assessDestructivePartDelete,
  handleTabListKeyDown,
} from "../../robot-builder/logic/uiAccessibility";
import type {
  RobotConnection,
  RobotPart,
} from "../../robot-builder/types/robot.types";
import { shouldHandleSimulationDriveShortcut } from "./simulationKeyboard";

function makePart(overrides: Partial<RobotPart> & { id: string }): RobotPart {
  return {
    name: overrides.id,
    type: "Structural Block",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [0.1, 0.1, 0.1],
    color: "#9aa0a6",
    mass: 0.2,
    ...overrides,
  };
}

describe("uiSafetyAccessibility (F8)", () => {
  it("keeps Space emergency-stop active on canvas/arena while preserving focused button and tab Space activation", () => {
    expect(
      shouldHandleSimulationDriveShortcut({
        key: " ",
        code: "Space",
        target: { tagName: "CANVAS" },
      })
    ).toBe(true);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: "w",
        code: "KeyW",
        target: { tagName: "DIV" },
      })
    ).toBe(true);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: " ",
        code: "Space",
        target: { tagName: "BUTTON" },
      })
    ).toBe(false);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: " ",
        code: "Space",
        target: {
          tagName: "DIV",
          getAttribute: (name: string) => (name === "role" ? "tab" : null),
        },
      })
    ).toBe(false);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: " ",
        code: "Space",
        target: {
          tagName: "SPAN",
          closest: (selector: string) =>
            selector.includes("button") ? { tagName: "BUTTON" } : null,
        },
      })
    ).toBe(false);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: "w",
        code: "KeyW",
        target: { tagName: "INPUT" },
      })
    ).toBe(false);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: "a",
        code: "KeyA",
        target: { tagName: "DIV", isContentEditable: true },
      })
    ).toBe(false);

    expect(
      shouldHandleSimulationDriveShortcut({
        key: "w",
        code: "KeyW",
        ctrlKey: true,
        target: { tagName: "CANVAS" },
      })
    ).toBe(false);
  });

  it("navigates ARIA tablists with ArrowRight/ArrowLeft/Home/End and updates DOM focus", () => {
    const tabs = ["wiring", "inspector", "diagnostics"] as const;
    const focusMocks = [vi.fn(), vi.fn(), vi.fn()];
    const parentElement = {
      querySelectorAll: () => focusMocks.map((focus) => ({ focus })),
    };

    const preventDefault = vi.fn();
    const onSelect = vi.fn();

    const movedRight = handleTabListKeyDown(
      { key: "ArrowRight", preventDefault, currentTarget: { parentElement } },
      tabs,
      "wiring",
      onSelect
    );
    expect(movedRight).toBe("inspector");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("inspector");
    expect(focusMocks[1]).toHaveBeenCalledTimes(1);

    const wrappedLeft = handleTabListKeyDown(
      { key: "ArrowLeft", preventDefault, currentTarget: { parentElement } },
      tabs,
      "wiring",
      onSelect
    );
    expect(wrappedLeft).toBe("diagnostics");
    expect(focusMocks[2]).toHaveBeenCalledTimes(1);

    const jumpedHome = handleTabListKeyDown(
      { key: "Home", preventDefault, currentTarget: { parentElement } },
      tabs,
      "diagnostics",
      onSelect
    );
    expect(jumpedHome).toBe("wiring");
    expect(focusMocks[0]).toHaveBeenCalledTimes(1);

    const ignored = handleTabListKeyDown(
      { key: "Enter", preventDefault, currentTarget: { parentElement } },
      tabs,
      "wiring",
      onSelect
    );
    expect(ignored).toBeNull();
  });

  it("flags destructive foundation and parent/motor-wheel deletions for confirmation while allowing leaf deletes", () => {
    const foundation = makePart({ id: "foundation-chassis", type: "Structural Block" });
    const topPlate = makePart({
      id: "foundation-top-plate",
      type: "Armor Plate",
      foundationMemberRole: "plate",
    });
    const motor = makePart({ id: "motor-1", type: "Motor" });
    const wheel = makePart({ id: "wheel-1", type: "Wheel" });
    const carrier = makePart({ id: "carrier-1", type: "Structural Block" });
    const mountedArmor = makePart({ id: "armor-1", type: "Armor Plate" });
    const leafPart = makePart({ id: "leaf-plate", type: "Armor Plate" });

    const parts = [
      foundation,
      topPlate,
      motor,
      wheel,
      carrier,
      mountedArmor,
      leafPart,
    ];
    const connections: RobotConnection[] = [
      {
        id: "conn-mw",
        type: "Motor-Wheel",
        sourceId: "motor-1",
        targetId: "wheel-1",
        parentId: "motor-1",
        childId: "wheel-1",
        parentMountPointId: "shaft",
        childMountPointId: "hub",
        relativePosition: [0, 0, 0.03],
        relativeRotation: [0, 0, 0],
      },
      {
        id: "conn-cs",
        type: "Mechanical",
        sourceId: "carrier-1",
        targetId: "armor-1",
        parentId: "carrier-1",
        childId: "armor-1",
        parentMountPointId: "top",
        childMountPointId: "bottom",
        relativePosition: [0, 0.05, 0],
        relativeRotation: [0, 0, 0],
      },
    ];

    expect(
      assessDestructivePartDelete("foundation-chassis", parts, connections)
    ).toMatchObject({
      confirmLabel: "Delete Foundation",
    });

    expect(
      assessDestructivePartDelete("foundation-top-plate", parts, connections)
    ).toMatchObject({
      confirmLabel: "Delete Foundation",
    });

    expect(
      assessDestructivePartDelete("motor-1", parts, connections)
    ).toMatchObject({
      confirmLabel: "Delete Motor",
    });

    expect(
      assessDestructivePartDelete("carrier-1", parts, connections)
    ).toMatchObject({
      confirmLabel: "Delete Part",
    });

    expect(
      assessDestructivePartDelete("leaf-plate", parts, connections)
    ).toBeNull();
  });
});
