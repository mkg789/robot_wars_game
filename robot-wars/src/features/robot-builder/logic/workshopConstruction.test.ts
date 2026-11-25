import { beforeEach, describe, expect, it } from "vitest";
import { batteryCatalogue } from "../data/batteryCatalogue";
import { controllerCatalogue } from "../data/controllerCatalogue";
import { structuralCatalogue } from "../data/structuralCatalogue";
import { initialParts } from "../data/initialRobot";
import { validateRobotAssembly } from "./assemblyValidation";
import {
  computeAttachedChildTransform,
  evaluateInterfaceCompatibility,
  resolvePartMountingInterfaces,
} from "./mountingInterfaces";
import { resolveAssemblySimulationVisualSpec } from "../../simulation/logic/simulationAssembly";
import { SimulationWorld } from "../../simulation/logic/simulationWorld";
import { STANDARD_ROBOT_WARS_ARENA } from "../../simulation/logic/arenaModel";
import { useRobotStore } from "../../../store/robotStore";
import type { AttachmentInterface, RobotPart } from "../types/robot.types";

function resetWorkshopStore() {
  useRobotStore.setState({
    parts: initialParts.map((part) => ({
      ...part,
      position: [...part.position] as [number, number, number],
      rotation: [...part.rotation] as [number, number, number],
      size: [...part.size] as [number, number, number],
    })),
    connections: [],
    hiddenPartIds: [],
    selectedId: "chassis",
    transformMode: "select",
    historyPast: [],
    historyFuture: [],
    foundation: null,
    foundationId: null,
    stage: "foundation",
    drivetrain: {
      type: "differential-2",
      left: [null],
      right: [null],
      mappingCustomized: false,
    },
    selectedMotorCatalogueId: null,
    selectedMountZoneId: null,
    selectedWheelCatalogueId: null,
    selectedWheelMotorId: null,
    selectedWheelDiameterCm: 22,
    selectedWheelWidthCm: 7,
    selectedBatteryCatalogueId: "standard-lipo",
    selectedControllerCatalogueId: "arduino-uno",
    selectedStructuralCatalogueId: "structural-rail",
  });
}

describe("Phase 4.7: Workshop Construction & Mechanical Assembly Expansion", () => {
  beforeEach(resetWorkshopStore);

  describe("1. Structural Catalogue & Canonical Dimensions", () => {
    it("provides reusable structural definitions with canonical geometry and non-fabricated provenance", () => {
      expect(structuralCatalogue.length).toBeGreaterThanOrEqual(10);
      for (const item of structuralCatalogue) {
        expect(item.dimensions.length).toBeGreaterThan(0);
        expect(item.dimensions.height).toBeGreaterThan(0);
        expect(item.dimensions.width).toBeGreaterThan(0);
        expect(item.massKg).toBeGreaterThan(0);
        expect(item.engineeringSpec.category).toBe("structural");
        expect(item.engineeringSpec.generalProvenance?.method).toBe("estimated");
      }
    });
  });

  describe("2. Mounting Interfaces & Compatibility", () => {
    it("evaluates compatible, incompatible, and explicit unknown interface compatibility honestly", () => {
      const compat = evaluateInterfaceCompatibility(
        {
          id: "rail-top",
          label: "Rail Top",
          kind: "rail-slot",
          position: [0, 0.03, 0],
          rotation: [0, 0, 0],
          compatibleWith: ["bracket-face"],
          compatibilityStatus: "compatible",
        },
        {
          id: "bracket-base",
          label: "Bracket Base",
          kind: "bracket-face",
          position: [0, -0.05, 0],
          rotation: [0, 0, 0],
          compatibleWith: ["rail-slot"],
          compatibilityStatus: "compatible",
        }
      );
      expect(compat.status).toBe("compatible");

      const incompat = evaluateInterfaceCompatibility(
        {
          id: "wheel-hub",
          label: "Wheel Hub",
          kind: "wheel-hub",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          compatibleWith: ["motor-mount"],
          compatibilityStatus: "compatible",
        },
        {
          id: "deck",
          label: "Deck",
          kind: "foundation-deck",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          compatibleWith: ["plate-mount"],
          compatibilityStatus: "compatible",
        }
      );
      expect(incompat.status).toBe("incompatible");

      const unknownIface: AttachmentInterface = {
        id: "custom",
        label: "Custom Interface",
        kind: "unknown",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: [],
        compatibilityStatus: "unknown",
      };
      expect(evaluateInterfaceCompatibility(unknownIface, null).status).toBe(
        "unknown"
      );
    });

    it("computes flush relative & world attachment transforms between parent and child interfaces", () => {
      const parent: RobotPart = {
        id: "rail-1",
        name: "Rail",
        type: "Structural Block",
        structuralCatalogueId: "structural-rail",
        structuralCategory: "rail",
        position: [0.2, 0.5, 0],
        rotation: [0, 0, 0],
        size: [1.2, 0.06, 0.06],
        color: "#94a3b8",
        mass: 0.55,
      };
      const child: RobotPart = {
        id: "plate-1",
        name: "Plate",
        type: "Armor Plate",
        structuralCatalogueId: "flat-plate",
        structuralCategory: "plate",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [0.6, 0.04, 0.45],
        color: "#6b7280",
        mass: 0.42,
      };

      const railTop = resolvePartMountingInterfaces(parent).find(
        (i) => i.id === "rail-top"
      )!;
      const plateBottom = resolvePartMountingInterfaces(child).find(
        (i) => i.id === "mount-bottom"
      )!;
      const result = computeAttachedChildTransform(
        parent,
        railTop,
        child,
        plateBottom
      );

      // Rail center y=0.50 + top(0.03) + plate half-height(0.02) = 0.55
      expect(result.worldPosition[0]).toBeCloseTo(0.2, 5);
      expect(result.worldPosition[1]).toBeCloseTo(0.55, 5);
      expect(result.relativePosition[1]).toBeCloseTo(0.05, 5);
    });
  });

  describe("3. Store Construction, Attachment Propagation, Preservation & Undo/Redo", () => {
    it("adds, duplicates, replaces, re-attaches, transforms, and preserves structural components", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      expect(useRobotStore.getState().foundation?.confirmed).toBe(false);
      store.confirmFoundation();
      store.setStage("structure");
      expect(useRobotStore.getState().stage).toBe("structure");

      // Add a rail mounted to foundation
      const railId = store.addStructuralPart("structural-rail", {
        parentId: "foundation-chassis",
        parentInterfaceId: "foundation-top-center",
      });
      expect(railId).not.toBeNull();

      // Add an L-bracket mounted on top of the rail (hierarchical parent-child)
      const bracketId = store.addStructuralPart("l-bracket", {
        parentId: railId!,
        parentInterfaceId: "rail-top",
      });
      expect(bracketId).not.toBeNull();

      // Move parent rail -> child bracket must move rigidly with parent
      const railBefore = useRobotStore
        .getState()
        .parts.find((p) => p.id === railId)!;
      const bracketBefore = useRobotStore
        .getState()
        .parts.find((p) => p.id === bracketId)!;
      useRobotStore
        .getState()
        .updatePartPosition(railId!, [
          railBefore.position[0] + 0.35,
          railBefore.position[1],
          railBefore.position[2],
        ]);
      const bracketAfterParentMove = useRobotStore
        .getState()
        .parts.find((p) => p.id === bracketId)!;
      expect(bracketAfterParentMove.position[0]).toBeCloseTo(
        bracketBefore.position[0] + 0.35,
        5
      );

      // Adjust attached child position directly -> updates relative offset cleanly
      useRobotStore
        .getState()
        .updatePartPosition(bracketId!, [
          bracketAfterParentMove.position[0] + 0.1,
          bracketAfterParentMove.position[1] + 0.05,
          bracketAfterParentMove.position[2],
        ]);
      expect(
        useRobotStore
          .getState()
          .parts.find((p) => p.id === bracketId)!.position[0]
      ).toBeCloseTo(bracketAfterParentMove.position[0] + 0.1, 5);

      // Duplicate & replace structural component
      const dupId = useRobotStore.getState().duplicatePart(railId!);
      expect(dupId).not.toBeNull();
      useRobotStore.getState().replaceStructuralPart(dupId!, "box-beam");
      const replaced = useRobotStore
        .getState()
        .parts.find((p) => p.id === dupId)!;
      expect(replaced.structuralCatalogueId).toBe("box-beam");
      expect(replaced.structuralVisualShape).toBe("box-beam");

      // Resizing foundation preserves custom structural components cleanly
      useRobotStore.getState().updateFoundationDimensions({ length: 2.5 });
      expect(
        useRobotStore.getState().parts.some((p) => p.id === railId)
      ).toBe(true);
      expect(
        useRobotStore.getState().parts.some((p) => p.id === dupId)
      ).toBe(true);

      // Removing parent structural rail cleanly detaches child bracket without leaving dangling connections
      useRobotStore.getState().deletePartById(railId!);
      const remainingBracket = useRobotStore
        .getState()
        .parts.find((p) => p.id === bracketId);
      expect(remainingBracket).toBeDefined();
      expect(remainingBracket?.parentAttachmentId).toBeUndefined();
      expect(
        useRobotStore
          .getState()
          .connections.some((c) => c.parentId === railId || c.childId === railId)
      ).toBe(false);
    });

    it("supports bounded Undo and Redo across structural, transform, and drivetrain edits cleanly", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      const initialCount = useRobotStore.getState().parts.length;
      const railId = store.addStructuralPart("crossbar", {
        parentId: "foundation-chassis",
      });
      expect(useRobotStore.getState().parts.length).toBe(initialCount + 1);
      expect(useRobotStore.getState().historyPast.length).toBeGreaterThan(0);

      // Previewing transforms does NOT pollute Undo history and can be canceled cleanly
      const prePreviewHistoryLen = useRobotStore.getState().historyPast.length;
      const crossbar = useRobotStore
        .getState()
        .parts.find((p) => p.id === railId)!;
      useRobotStore
        .getState()
        .previewPartTransform(railId!, [0.4, 0.8, 0], crossbar.rotation);
      expect(useRobotStore.getState().historyPast.length).toBe(
        prePreviewHistoryLen
      );
      expect(
        useRobotStore.getState().parts.find((p) => p.id === railId)?.position[0]
      ).toBeCloseTo(0.4, 4);

      // Cancel preview restores baseline cleanly without adding undo history
      useRobotStore
        .getState()
        .previewPartTransform(railId!, crossbar.position, crossbar.rotation);
      expect(useRobotStore.getState().historyPast.length).toBe(
        prePreviewHistoryLen
      );
      expect(
        useRobotStore.getState().parts.find((p) => p.id === railId)?.position[0]
      ).toBeCloseTo(crossbar.position[0], 4);

      // Apply commits 1 clean undo entry
      useRobotStore
        .getState()
        .updatePartTransform(railId!, [0.4, 0.8, 0], [0, 0.5, 0]);
      expect(useRobotStore.getState().historyPast.length).toBe(
        prePreviewHistoryLen + 1
      );

      // Undo restores pre-move position, then undo again removes crossbar
      expect(useRobotStore.getState().undo()).toBe(true);
      expect(
        useRobotStore.getState().parts.find((p) => p.id === railId)?.position[0]
      ).toBeCloseTo(crossbar.position[0], 4);

      expect(useRobotStore.getState().undo()).toBe(true);
      expect(
        useRobotStore.getState().parts.some((p) => p.id === railId)
      ).toBe(false);

      // Redo restores crossbar and then its transformed pose
      expect(useRobotStore.getState().redo()).toBe(true);
      expect(
        useRobotStore.getState().parts.some((p) => p.id === railId)
      ).toBe(true);
      expect(useRobotStore.getState().redo()).toBe(true);
      expect(
        useRobotStore.getState().parts.find((p) => p.id === railId)?.position[0]
      ).toBeCloseTo(0.4, 4);

      // startNewBuild resets history cleanly
      useRobotStore.getState().startNewBuild();
      expect(useRobotStore.getState().historyPast).toHaveLength(0);
      expect(useRobotStore.getState().historyFuture).toHaveLength(0);
    });
  });

  describe("4. Placement Validation, Overlap Diagnostics & Simulation Consistency", () => {
    it("detects unattached parts, out-of-bounds placement, invalid dimensions, and overlaps", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      const id1 = store.addStructuralPart("box-beam", {
        parentId: "foundation-chassis",
        parentInterfaceId: "foundation-top-center",
      });
      const id2 = store.addStructuralPart("flat-plate", {
        parentId: "foundation-chassis",
        parentInterfaceId: "foundation-top-center",
      });
      // Detach plate and push overlapping & out of bounds
      store.detachPart(id2!);
      store.updatePartPosition(id2!, [4.5, 0.5, 0]);

      const outReport = validateRobotAssembly({
        parts: useRobotStore.getState().parts,
        connections: useRobotStore.getState().connections,
        foundation: useRobotStore.getState().foundation,
      });
      expect(
        outReport.warnings.some((d) => d.code === "outside-foundation-bounds")
      ).toBe(true);
      expect(
        outReport.warnings.some((d) => d.code === "unattached-part")
      ).toBe(true);

      // Overlap id2 directly into id1
      const pos1 = useRobotStore
        .getState()
        .parts.find((p) => p.id === id1)!.position;
      store.updatePartPosition(id2!, pos1);
      const overlapReport = validateRobotAssembly({
        parts: useRobotStore.getState().parts,
        connections: useRobotStore.getState().connections,
        foundation: useRobotStore.getState().foundation,
      });
      expect(
        overlapReport.warnings.some((d) => d.code === "component-overlap")
      ).toBe(true);

      // Non-positive mass produces an error
      store.updatePartMass(id1!, 0);
      const errorReport = validateRobotAssembly({
        parts: useRobotStore.getState().parts,
        connections: useRobotStore.getState().connections,
        foundation: useRobotStore.getState().foundation,
      });
      expect(errorReport.isValid).toBe(false);
      expect(
        errorReport.errors.some((d) => d.code === "invalid-dimension")
      ).toBe(true);
    });

    it("propagates Workshop structural additions cleanly into Simulation visual spec and OBB footprint", () => {
      const store = useRobotStore.getState();
      store.startNewBuild();
      store.confirmFoundation();

      // Add front bumper & top rail
      const bumperId = store.addStructuralPart("reinforced-bumper", {
        parentId: "foundation-chassis",
        parentInterfaceId: "foundation-front-face",
      });
      store.addStructuralPart("hex-standoff", {
        parentId: "foundation-chassis",
        parentInterfaceId: "foundation-top-front",
      });

      // Install minimum drive system for simulation
      store.installBattery(batteryCatalogue[1].id);
      store.installController(controllerCatalogue[1].id);
      store.selectMotorCatalogueItem("standard-dc");
      store.selectMountZone("front-left");
      store.placeMotor();
      store.selectMountZone("front-right");
      store.placeMotor();

      const motors = useRobotStore
        .getState()
        .parts.filter((p) => p.type === "Motor");
      store.selectWheelCatalogueItem("standard-rubber");
      for (const motor of motors) {
        store.assignWheel(motor.id);
      }
      store.setStage("drivetrain");

      const currentState = useRobotStore.getState();
      const simSpec = resolveAssemblySimulationVisualSpec({
        parts: currentState.parts,
        connections: currentState.connections,
        drivetrain: currentState.drivetrain,
      });

      const bumperVisual = simSpec.parts.find((p) => p.partId === bumperId)!;
      expect(bumperVisual).toBeDefined();
      expect(bumperVisual.structuralVisualShape).toBe("reinforced-bumper");

      const worldInit = SimulationWorld.fromAssembly({
        parts: currentState.parts,
        connections: currentState.connections,
        drivetrain: currentState.drivetrain,
        foundation: currentState.foundation,
        arena: STANDARD_ROBOT_WARS_ARENA,
      });
      expect(worldInit.success).toBe(true);
      // Footprint must enclose front bumper extending past foundation length (2.0 + 2*0.14 = 2.28m)
      expect(worldInit.world!.getRobotFootprint().lengthM).toBeGreaterThanOrEqual(
        2.27
      );
    });
  });
});
