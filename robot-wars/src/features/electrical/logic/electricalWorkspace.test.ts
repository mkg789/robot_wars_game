import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { validateRobotAssembly } from "../../robot-builder/logic/assemblyValidation";
import { resolveAssemblySimulationVisualSpec } from "../../simulation/logic/simulationAssembly";
import {
  ELECTRICAL_CATALOGUE_CATEGORY_LABELS,
  electricalCatalogue,
  getElectricalCatalogueItem,
} from "../data/electricalCatalogue";
import { resolvePartElectricalSpec } from "./electricalComponentAdapters";
import { computeElectricalSchematicLayout } from "./electricalSchematicLayout";
import { validateElectricalAssembly } from "./electricalValidation";
import type {
  ElectricalCatalogueCategory,
  ElectricalConnectorSpec,
} from "../types/electrical.types";

describe("Phase 5.2: Electrical Component Catalogue & Wiring Workspace", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
  });

  it("provides electrical catalogue coverage across all categories with honest provenance and no fabricated verified claims", () => {
    const categories = Object.keys(
      ELECTRICAL_CATALOGUE_CATEGORY_LABELS
    ) as ElectricalCatalogueCategory[];
    for (const cat of categories) {
      const items = electricalCatalogue.filter((item) => item.category === cat);
      expect(items.length).toBeGreaterThanOrEqual(3);
    }

    // Check batteries & generic packs preserve honest unknown discharge/IR fields rather than inventing C-ratings
    const genericAA = getElectricalCatalogueItem("elec-battery-pack-aa")!;
    expect(genericAA.provenance.method).toBe("estimated");
    expect(genericAA.electricalSpecTemplate.unknownFields).toContain(
      "maxContinuousDischargeA"
    );

    const solenoid = getElectricalCatalogueItem("elec-solenoid-actuator")!;
    expect(solenoid.provenance.method).toBe("unknown");
    expect(solenoid.electricalSpecTemplate.unknownFields.length).toBeGreaterThan(0);

    // Check verified datasheet controller & sensor items retain datasheet URL and positive physical bounds
    const pico = getElectricalCatalogueItem("elec-rpi-pico")!;
    expect(pico.datasheetUrl).toContain("datasheets.raspberrypi.com");
    expect(pico.provenance.method).toBe("datasheet");
    if (pico.provenance.method === "datasheet") {
      expect(pico.provenance.verified).toBe(true);
    }
    expect(pico.massKg).toBeGreaterThan(0);
    expect(pico.dimensions.length).toBeGreaterThan(0);
  });

  it("installs electrical catalogue parts mechanically into the RobotPart hierarchy and integrates cleanly with simulation visuals & undo/redo", () => {
    const store = useRobotStore.getState();
    const plateId = store.addStructuralPart("flat-plate");
    expect(plateId).toBeTruthy();

    const batId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-lipo-3s");
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v", {
        parentId: plateId!,
      });
    const sonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic", {
        parentId: plateId!,
      });

    expect(batId).toBeTruthy();
    expect(buckId).toBeTruthy();
    expect(sonarId).toBeTruthy();

    const state = useRobotStore.getState();
    const batPart = state.parts.find((p) => p.id === batId)!;
    const buckPart = state.parts.find((p) => p.id === buckId)!;
    expect(batPart.electricalCatalogueId).toBe("elec-lipo-3s");
    expect(resolvePartElectricalSpec(batPart)?.componentType).toBe("battery");
    expect(
      state.connections.some(
        (c) => c.type === "Mechanical" && c.parentId === plateId && c.childId === buckId
      )
    ).toBe(true);

    // Non-overlapping deterministic deck stagger when adding multiple items on chassis
    const stateAll = useRobotStore.getState();
    expect(stateAll.parts.find((p) => p.id === batId)!.position).not.toEqual(
      buckPart.position
    );

    // Resolves cleanly inside existing simulation visual builder without parallel store
    const visualSpec = resolveAssemblySimulationVisualSpec({
      parts: stateAll.parts,
      connections: stateAll.connections,
      drivetrain: stateAll.drivetrain,
    });
    expect(visualSpec.parts.some((p) => p.partId === buckId)).toBe(true);

    // Undo removes sonar cleanly and redo brings it back
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(useRobotStore.getState().parts.some((p) => p.id === sonarId)).toBe(false);
    expect(useRobotStore.getState().redo()).toBe(true);
    expect(useRobotStore.getState().parts.some((p) => p.id === sonarId)).toBe(true);
  });

  it("supports end-to-end connection creation, metadata editing, pin/connector assignment, safe replacement, and deletion cleanup", () => {
    const store = useRobotStore.getState();
    const batId = store.installElectricalCatalogueItem("elec-lipo-3s")!; // 9.0-12.6V
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!; // 7-35V -> 5.0V 3A
    const sonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!; // 4.5-5.5V

    // Wire 3S Battery -> 5V Buck Converter -> HC-SR04 Ultrasonic Sensor (+ grounds)
    const wire1 = useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      sourcePinId: "pin-bat-pos",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      targetPinId: "elec-buck-5v-vin-pin",
      connectionType: "power",
      wireMetadata: { wireGaugeAwg: 16, color: "Red" },
      provenance: { method: "user-supplied" },
    })!;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-gnd",
      sourcePinId: "pin-bat-neg",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-gnd",
      targetPinId: "elec-buck-5v-gnd-pin",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
    const wire2 = useRobotStore.getState().addElectricalConnection({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      sourcePinId: "elec-buck-5v-vout-pin",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      targetPinId: "elec-hcsr04-ultrasonic-vcc-pin",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    })!;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-gnd",
      sourcePinId: "elec-buck-5v-gnd-pin",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-gnd",
      targetPinId: "elec-hcsr04-ultrasonic-gnd-pin",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });

    // Edit wire metadata & assign connector
    useRobotStore.getState().updateElectricalConnection(wire1, {
      notes: "Main fused buck feed",
      wireMetadata: { wireGaugeAwg: 14, color: "Red" },
    });
    const xt60Plug: ElectricalConnectorSpec = {
      connectorId: "conn-xt60-buck",
      connectorType: "xt60",
      name: "XT60 Buck Feed",
      pinCount: 2,
      pinDefinitions: [],
      provenance: { method: "user-supplied" },
    };
    useRobotStore
      .getState()
      .assignConnectorToInterface(buckId, "elec-buck-5v-pwr-in", xt60Plug);

    let report = useRobotStore.getState().validateElectricalState();
    expect(report.isValid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(
      useRobotStore
        .getState()
        .electricalConnections.find((c) => c.id === wire1)?.notes
    ).toBe("Main fused buck feed");

    // Reassign pin cleanly
    useRobotStore
      .getState()
      .assignPinToElectricalConnection(wire2, "target", "elec-hcsr04-ultrasonic-vcc-pin");
    expect(
      useRobotStore
        .getState()
        .electricalConnections.find((c) => c.id === wire2)?.targetPinId
    ).toBe("elec-hcsr04-ultrasonic-vcc-pin");

    // Replace ultrasonic sonar with 5-Ch IR array -> removes sonar-specific connections without dangling refs!
    const replaced = useRobotStore
      .getState()
      .replaceElectricalComponent(sonarId, "elec-line-follower");
    expect(replaced).toBe(true);
    const postReplaceState = useRobotStore.getState();
    expect(
      postReplaceState.parts.find((p) => p.id === sonarId)?.electricalCatalogueId
    ).toBe("elec-line-follower");
    // Only Battery <-> Buck wires remain; old sonar wires were cleanly pruned
    expect(postReplaceState.electricalConnections).toHaveLength(2);
    expect(postReplaceState.lastReplacementWarning).toContain("removed 2 incompatible wire");

    // Undo restores replaced part AND pruned sonar wires!
    expect(useRobotStore.getState().undo()).toBe(true);
    expect(
      useRobotStore.getState().parts.find((p) => p.id === sonarId)
        ?.electricalCatalogueId
    ).toBe("elec-hcsr04-ultrasonic");
    expect(useRobotStore.getState().electricalConnections).toHaveLength(4);

    // Deleting battery cleans up Battery <-> Buck wires seamlessly
    useRobotStore.getState().deletePartById(batId);
    report = useRobotStore.getState().validateElectricalState();
    expect(
      useRobotStore
        .getState()
        .electricalConnections.some(
          (c) => c.sourcePartId === batId || c.targetPartId === batId
        )
    ).toBe(false);
    // Remaining Buck converter detects missing incoming power connection cleanly
    expect(
      report.diagnostics.some(
        (d) => d.code === "missing-power-connection" && d.partId === buckId
      )
    ).toBe(true);
  });

  it("detects pin conflicts, aggregate rail overload, missing power, and focuses affected part/connection/pin from diagnostics", () => {
    const store = useRobotStore.getState();
    const ctrlId = store.installElectricalCatalogueItem("elec-arduino-uno")!; // 5V rail max 0.5A
    const servo1Id = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // 0.35A nom power + pwm
    const servo2Id = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // +0.35A = 0.70A > 0.5A logic rail!

    // Wire both servos off Uno 5V logic rail AND tie both PWM lines onto the exact same PWM1 pin
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: ctrlId,
      sourceInterfaceId: "ctrl-logic-vcc",
      sourcePinId: "pin-vcc",
      targetPartId: servo1Id,
      targetInterfaceId: "servo-pwr-in",
      targetPinId: "servo-vcc",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: ctrlId,
      sourceInterfaceId: "ctrl-logic-vcc",
      sourcePinId: "pin-vcc",
      targetPartId: servo2Id,
      targetInterfaceId: "servo-pwr-in",
      targetPinId: "servo-vcc",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    const pwmWire1 = useRobotStore.getState().addElectricalConnection({
      sourcePartId: ctrlId,
      sourceInterfaceId: "ctrl-gpio-signals",
      sourcePinId: "pin-pwm-0",
      targetPartId: servo1Id,
      targetInterfaceId: "servo-pwm-in",
      targetPinId: "servo-sig",
      connectionType: "pwm",
      signalProtocol: "pwm",
      provenance: { method: "user-supplied" },
    })!;
    useRobotStore.getState().addElectricalConnection({
      sourcePartId: ctrlId,
      sourceInterfaceId: "ctrl-gpio-signals",
      sourcePinId: "pin-pwm-0",
      targetPartId: servo2Id,
      targetInterfaceId: "servo-pwm-in",
      targetPinId: "servo-sig",
      connectionType: "pwm",
      signalProtocol: "pwm",
      provenance: { method: "user-supplied" },
    });

    const state = useRobotStore.getState();
    const combined = validateRobotAssembly({
      parts: state.parts,
      connections: state.connections,
      foundation: state.foundation,
      drivetrain: state.drivetrain,
      electricalConnections: state.electricalConnections,
    });
    const elReport = combined.electricalReport!;

    expect(
      elReport.diagnostics.some((d) => d.code === "rail-current-exceeded")
    ).toBe(true);
    const pinConflictDiag = elReport.diagnostics.find(
      (d) => d.code === "pin-conflict"
    );
    expect(pinConflictDiag).toBeDefined();
    expect(pinConflictDiag?.pinId).toBe("pin-pwm-0");
    expect(
      elReport.diagnostics.some(
        (d) => d.code === "missing-power-connection" && d.partId === ctrlId
      )
    ).toBe(true);

    // Clicking diagnostic focuses affected component, pin, and connection in store
    useRobotStore.getState().focusElectricalDiagnostic(pinConflictDiag!);
    const focusedState = useRobotStore.getState();
    expect(focusedState.selectedId).toBe(ctrlId);
    expect(focusedState.selectedElectricalPinId).toBe("pin-pwm-0");
    expect(focusedState.selectedElectricalConnectionId).toBe(pwmWire1);

    // Deterministic schematic layout places Battery->Regulator/PDB->Controller->Sensors/Servos with distinct curved wire paths
    const layout = computeElectricalSchematicLayout({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
      connectionResults: elReport.connectionResults,
      diagnostics: elReport.diagnostics,
    });
    const ctrlNode = layout.nodes.find((n) => n.part.id === ctrlId)!;
    const servoNode = layout.nodes.find((n) => n.part.id === servo1Id)!;
    expect(ctrlNode.column).toBe(2);
    expect(servoNode.column).toBe(3);
    expect(layout.wires).toHaveLength(4);
    expect(
      layout.wires.find((w) => w.connection.id === pwmWire1)?.pathD
    ).toContain(" C ");
    expect(new Set(layout.wires.map((w) => w.pathD)).size).toBe(4);
  });

  it("leaves no stale electrical references after removing a connection directly or via validateElectricalAssembly", () => {
    const batId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-lipo-2s")!;
    const ctrlId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-arduino-uno")!;
    const connId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    })!;

    useRobotStore.getState().setSelectedElectricalConnection(connId);
    useRobotStore.getState().removeElectricalConnection(connId);
    expect(useRobotStore.getState().selectedElectricalConnectionId).toBeNull();
    expect(useRobotStore.getState().electricalConnections).toHaveLength(0);

    // Also validates cleanly if stale connection object injected externally
    const report = validateElectricalAssembly({
      parts: useRobotStore.getState().parts,
      electricalConnections: [
        {
          id: "dangling-wire",
          sourcePartId: batId,
          sourceInterfaceId: "bat-power-out",
          targetPartId: "missing-node",
          targetInterfaceId: "in",
          connectionType: "power",
          provenance: { method: "user-supplied" },
        },
      ],
    });
    expect(report.isValid).toBe(false);
    expect(report.diagnostics[0].code).toBe("missing-component");
  });
});
