import { beforeEach, describe, expect, it } from "vitest";
import { useRobotStore } from "../../../store/robotStore";
import { analyzePowerDistribution } from "./powerDistributionAnalysis";
import { validateElectricalAssembly } from "./electricalValidation";
import { computeElectricalSchematicLayout } from "./electricalSchematicLayout";

describe("Phase 5.3: Power Distribution & Voltage Regulation", () => {
  beforeEach(() => {
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
  });

  it("propagates battery voltage through switch -> fuse -> PDB -> buck converter cleanly with efficiency-scaled upstream load", () => {
    const store = useRobotStore.getState();
    const batId = store.installElectricalCatalogueItem("elec-lipo-3s")!; // 11.1V (9.0-12.6V)
    const swId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-power-switch")!; // 30A SPST pass-through
    const fuseId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-inline-fuse-20a")!; // 20A pass-through
    const pdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!; // PDB pass-through
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!; // 7-35V -> 5.0V 3A, eff 0.85, dropout 2.0V
    const servoId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // 4.8-6.0V, 0.35A nom

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Power path: Battery -> Switch -> Fuse -> PDB -> Buck -> Servo
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: swId,
      targetInterfaceId: "sw-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: swId,
      sourceInterfaceId: "sw-out",
      targetPartId: fuseId,
      targetInterfaceId: "fuse-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: fuseId,
      sourceInterfaceId: "fuse-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-out",
      targetPartId: servoId,
      targetInterfaceId: "servo-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    // Common Ground chain: Battery <-> PDB <-> Buck <-> Servo
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-gnd",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-gnd",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-gnd",
      targetPartId: servoId,
      targetInterfaceId: "servo-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });

    const state = useRobotStore.getState();
    const report = validateElectricalAssembly({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
    });

    expect(report.isValid).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.powerAnalysis).toBeDefined();
    expect(report.powerAnalysis!.ungroundedConsumerCount).toBe(0);

    // Verify regulated 5V rail summary on Buck converter
    const buckRail = report.powerAnalysis!.rails.find(
      (r) => r.sourcePartId === buckId
    )!;
    expect(buckRail.kind).toBe("regulated-rail");
    expect(buckRail.voltageV?.nominalV).toBe(5);
    expect(buckRail.totalKnownLoadA).toBeCloseTo(0.35, 2);
    expect(buckRail.groundVerified).toBe(true);
    expect(buckRail.status).toBe("healthy");

    // Verify battery upstream current reflects buck step-down ratio & efficiency: (5 * 0.35) / (11.1 * 0.85) ≈ 0.185A
    const batRail = report.powerAnalysis!.rails.find(
      (r) => r.sourcePartId === batId
    )!;
    expect(batRail.totalKnownLoadA).toBeGreaterThan(0.15);
    expect(batRail.totalKnownLoadA).toBeLessThan(0.25);

    // Schematic annotates power wire label & node rail badge cleanly
    const layout = computeElectricalSchematicLayout({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
      connectionResults: report.connectionResults,
      diagnostics: report.diagnostics,
      powerAnalysis: report.powerAnalysis,
    });
    const buckNode = layout.nodes.find((n) => n.part.id === buckId)!;
    expect(buckNode.powerBadge).toContain("5V");
    expect(
      layout.wires.some(
        (w) => w.connection.sourcePartId === buckId && w.label.includes("5V REG")
      )
    ).toBe(true);
  });

  it("catches propagated overvoltage through PDB/switch and regulator dropout/polarity violations", () => {
    const store = useRobotStore.getState();
    const bat3sId = store.installElectricalCatalogueItem("elec-lipo-3s")!; // 9.0-12.6V
    const batAAId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-battery-pack-aa")!; // 4.0-5.6V
    const pdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!; // Pass-through 3-28V
    const sonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!; // 4.5-5.5V!
    const reg7805Id = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-reg-7805")!; // Needs 5+2 = 7V!
    const boost12vId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-boost-12v")!; // Boost target 12V -> invalid if fed 12.6V!

    const addConn = useRobotStore.getState().addElectricalConnection;

    // Case 1: 3S Battery (12.6V) -> PDB (28V) -> 5V Sonar => propagated overvoltage!
    addConn({
      sourcePartId: bat3sId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    // Case 2: 4.8V AA pack (max 5.6V) -> 7805 Linear Regulator (dropout 2.0V -> needs >=7V)
    addConn({
      sourcePartId: batAAId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: reg7805Id,
      targetInterfaceId: "elec-reg-7805-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    // Case 3: 3S LiPo (12.6V max) -> 12V Boost converter -> input > boost output!
    addConn({
      sourcePartId: bat3sId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: boost12vId,
      targetInterfaceId: "elec-boost-12v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const state = useRobotStore.getState();
    const report = validateElectricalAssembly({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
    });

    expect(report.isValid).toBe(false);
    expect(
      report.diagnostics.some(
        (d) => d.code === "pass-through-overvoltage" && d.partId === sonarId
      )
    ).toBe(true);
    expect(
      report.diagnostics.some(
        (d) => d.code === "regulator-input-out-of-range" && d.partId === reg7805Id
      )
    ).toBe(true);
    expect(
      report.diagnostics.some(
        (d) => d.code === "buck-boost-polarity-fault" && d.partId === boost12vId
      )
    ).toBe(true);
  });

  it("detects regulator overload, missing upstream power source, missing ground, and unknown load currents without fabricating specs", () => {
    const store = useRobotStore.getState();
    const batId = store.installElectricalCatalogueItem("elec-lipo-3s")!;
    const reg7805Id = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-reg-7805")!; // 1.0A cont max!
    const servo1 = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // 0.35A nom
    const servo2 = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // +0.35A
    const servo3 = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // +0.35A = 1.05A > 1.0A!

    // Separate unfed PDB -> IR obstacle sensor (sensor has unknown nominalCurrentA!)
    const unfedPdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!;
    const irSensorId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-ir-obstacle")!;

    const addConn = useRobotStore.getState().addElectricalConnection;

    // Battery -> 7805 -> 3 Servos (WITHOUT ground return!)
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: reg7805Id,
      targetInterfaceId: "elec-reg-7805-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    for (const sId of [servo1, servo2, servo3]) {
      addConn({
        sourcePartId: reg7805Id,
        sourceInterfaceId: "elec-reg-7805-pwr-out",
        targetPartId: sId,
        targetInterfaceId: "servo-pwr-in",
        connectionType: "power",
        provenance: { method: "user-supplied" },
      });
    }

    // Unfed PDB -> IR Sensor
    addConn({
      sourcePartId: unfedPdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: irSensorId,
      targetInterfaceId: "elec-ir-obstacle-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const state = useRobotStore.getState();
    const { analysis, diagnostics } = analyzePowerDistribution({
      parts: state.parts,
      electricalConnections: state.electricalConnections,
    });

    // Regulator overloaded (1.05A > 1.0A)
    expect(
      diagnostics.some(
        (d) => d.code === "regulator-overload" && d.partId === reg7805Id
      )
    ).toBe(true);

    // Unfed downstream branch flagged cleanly
    expect(
      diagnostics.some(
        (d) => d.code === "missing-upstream-source" && d.partId === unfedPdbId
      )
    ).toBe(true);
    expect(analysis.consumerStates[irSensorId].energized).toBe(false);

    // IR Sensor current was missing in catalogue -> marked explicitly as hasUnknownLoadCurrent without guessing!
    const pdbRail = analysis.rails.find((r) => r.sourcePartId === unfedPdbId)!;
    expect(pdbRail.hasUnknownLoadCurrent).toBe(true);
    expect(pdbRail.totalKnownLoadA).toBe(0);

    // Missing ground references detected across consumers
    expect(analysis.ungroundedConsumerCount).toBeGreaterThanOrEqual(4);
    expect(analysis.consumerStates[servo1].hasMissingGround).toBe(true);
  });

  it("detects pass-through undervoltage sag/errors, propagates upstream regulator faults, and aggregates motor-driver loads recursively", () => {
    const store = useRobotStore.getState();
    const bat2sId = store.installElectricalCatalogueItem("elec-lipo-2s")!; // 6.0-8.4V
    const pdbId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-pdb-xt60")!;
    const ctrlId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-arduino-uno")!; // VIN min 7V max 12V -> 2S min 6V causes partial sag warning!
    const driverId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-l298n-hbridge")!;
    const motorId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-dc-motor-actuator")!; // 1.4A nominal

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: bat2sId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: ctrlId,
      targetInterfaceId: "ctrl-power-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: driverId,
      targetInterfaceId: "l298n-vm-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: driverId,
      sourceInterfaceId: "l298n-motor-out",
      targetPartId: motorId,
      targetInterfaceId: "motor-drive-input",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const st = useRobotStore.getState();
    const report = validateElectricalAssembly({
      parts: st.parts,
      electricalConnections: st.electricalConnections,
    });

    // Pass-through partial undervoltage sag warning fires for Arduino Uno fed by 2S LiPo via PDB
    expect(
      report.diagnostics.some(
        (d) =>
          d.code === "voltage-mismatch" &&
          d.severity === "warning" &&
          d.partId === ctrlId &&
          d.id === `pwr-pt-uv-sag-${ctrlId}`
      )
    ).toBe(true);

    // Battery and PDB aggregate motor load (1.4A) recursively through the L298N motor-driver
    const batRail = report.powerAnalysis!.rails.find((r) => r.sourcePartId === bat2sId)!;
    expect(batRail.totalKnownLoadA).toBeGreaterThanOrEqual(1.4);
    expect(batRail.consumerPartIds).toContain(motorId);

    // Separate upstream regulator fault (AA 4.8V -> 7805 dropout) propagates `hasPathFault` to downstream sonar
    useRobotStore.getState().startNewBuild();
    useRobotStore.getState().confirmFoundation();
    const batAAId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-battery-pack-aa")!;
    const reg7805Id = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-reg-7805")!;
    const sonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;
    const addConn2 = useRobotStore.getState().addElectricalConnection;
    addConn2({
      sourcePartId: batAAId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: reg7805Id,
      targetInterfaceId: "elec-reg-7805-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn2({
      sourcePartId: reg7805Id,
      sourceInterfaceId: "elec-reg-7805-pwr-out",
      targetPartId: sonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const st2 = useRobotStore.getState();
    const faultReport = validateElectricalAssembly({
      parts: st2.parts,
      electricalConnections: st2.electricalConnections,
    });
    expect(faultReport.powerAnalysis!.consumerStates[sonarId].hasPathFault).toBe(true);
    expect(faultReport.powerAnalysis!.consumerStates[sonarId].pathFaultReason).toContain(
      "dropout"
    );
  });

  it("F3: normalizes reversed (input -> output) power wires consistently across compatibility, validation, and power propagation", () => {
    const store = useRobotStore.getState();
    const batId = store.installElectricalCatalogueItem("elec-lipo-3s")!; // 9.0-12.6V
    const swId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-power-switch")!;
    const buckId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-buck-5v")!; // 7-35V -> 5.0V
    const servoId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-servo-actuator")!; // 4.8-6.0V, 0.35A
    const sonarId = useRobotStore
      .getState()
      .installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!; // 4.5-5.5V

    const addConn = useRobotStore.getState().addElectricalConnection;
    // Wire valid Servo chain strictly in REVERSED endpoint order: Servo -> Buck -> Switch -> Battery
    addConn({
      sourcePartId: servoId,
      sourceInterfaceId: "servo-pwr-in",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-pwr-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-pwr-in",
      targetPartId: swId,
      targetInterfaceId: "sw-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: swId,
      sourceInterfaceId: "sw-in",
      targetPartId: batId,
      targetInterfaceId: "bat-power-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: batId,
      sourceInterfaceId: "bat-gnd",
      targetPartId: buckId,
      targetInterfaceId: "elec-buck-5v-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: buckId,
      sourceInterfaceId: "elec-buck-5v-gnd",
      targetPartId: servoId,
      targetInterfaceId: "servo-gnd",
      connectionType: "ground",
      provenance: { method: "user-supplied" },
    });

    const okState = useRobotStore.getState();
    const okReport = validateElectricalAssembly({
      parts: okState.parts,
      electricalConnections: okState.electricalConnections,
    });
    expect(okReport.isValid).toBe(true);
    expect(okReport.powerAnalysis?.consumerStates[servoId]?.energized).toBe(true);
    expect(okReport.powerAnalysis?.consumerStates[servoId]?.deliveredVoltageV?.nominalV).toBe(5);
    const batRail = okReport.powerAnalysis?.rails.find((r) => r.sourcePartId === batId);
    expect(batRail?.totalKnownLoadA).toBeGreaterThan(0.1);

    // Separate reversed incompatible wire: 5V Sonar input -> 12.6V Battery output must report OVERVOLTAGE on Sonar (not Battery!)
    const badWireId = useRobotStore.getState().addElectricalConnection({
      sourcePartId: sonarId,
      sourceInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      targetPartId: batId,
      targetInterfaceId: "bat-power-out",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    })!;

    const mixedState = useRobotStore.getState();
    const mixedReport = validateElectricalAssembly({
      parts: mixedState.parts,
      electricalConnections: mixedState.electricalConnections,
    });
    expect(mixedReport.isValid).toBe(false);
    expect(mixedReport.connectionResults[badWireId].reason).toContain("Overvoltage hazard");
    const incompatDiag = mixedReport.diagnostics.find((d) => d.connectionId === badWireId)!;
    expect(incompatDiag.partId).toBe(sonarId);
    expect(incompatDiag.relatedPartId).toBe(batId);
    // Fault on Sonar branch does NOT poison healthy Switch -> Buck -> Servo branch off the same Battery
    expect(mixedReport.powerAnalysis?.consumerStates[sonarId]?.hasPathFault).toBe(true);
    expect(mixedReport.powerAnalysis?.consumerStates[servoId]?.hasPathFault).toBe(false);
    expect(mixedReport.powerAnalysis?.consumerStates[servoId]?.energized).toBe(true);
  });

  it("F3: detects regulator Vin_max overvoltage via pass-throughs and propagates regulator input faults without killing healthy siblings", () => {
    const store = useRobotStore.getState();
    const bat6sId = store.installElectricalCatalogueItem("elec-lipo-3s")!;
    // Configure battery as high-voltage 24V source (> 15V regulator inputMaxV)
    useRobotStore.getState().updatePartElectricalProperties(bat6sId, {
      interfaces: [
        {
          interfaceId: "bat-power-out",
          name: "24V Out",
          role: "power-output",
          voltageSpec: { nominalV: 22.2, minV: 19.0, maxV: 25.2 },
          currentSpec: { maxContinuousA: 40 },
          pinIds: ["pin-bat-pos"],
          provenance: { method: "user-supplied" },
        },
        {
          interfaceId: "bat-gnd",
          name: "GND",
          role: "ground",
          pinIds: ["pin-bat-neg"],
          provenance: { method: "user-supplied" },
        },
      ],
    });
    const pdbId = useRobotStore.getState().installElectricalCatalogueItem("elec-pdb-xt60")!;
    const reg7805Id = useRobotStore.getState().installElectricalCatalogueItem("elec-reg-7805")!; // 7-35V default -> clamp to maxV 15V
    useRobotStore.getState().updatePartElectricalProperties(reg7805Id, {
      driverOrRegulatorSpec: {
        powerRole: "linear",
        inputVoltageRangeV: { minV: 7, maxV: 15 },
        outputVoltageRangeV: { minV: 4.8, maxV: 5.2 },
        continuousCurrentPerChannelA: 1.0,
        dropoutVoltageV: 2.0,
      },
    });
    const badRegSonarId = useRobotStore.getState().installElectricalCatalogueItem("elec-hcsr04-ultrasonic")!;
    // Buck 5V supports 7-35V input cleanly, so it stays healthy at 25.2V while 7805 (max 15V) faults!
    const healthyBuckId = useRobotStore.getState().installElectricalCatalogueItem("elec-buck-5v")!;

    const addConn = useRobotStore.getState().addElectricalConnection;
    addConn({
      sourcePartId: bat6sId,
      sourceInterfaceId: "bat-power-out",
      targetPartId: pdbId,
      targetInterfaceId: "pdb-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: reg7805Id,
      targetInterfaceId: "elec-reg-7805-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: reg7805Id,
      sourceInterfaceId: "elec-reg-7805-pwr-out",
      targetPartId: badRegSonarId,
      targetInterfaceId: "elec-hcsr04-ultrasonic-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });
    addConn({
      sourcePartId: pdbId,
      sourceInterfaceId: "pdb-bus-out",
      targetPartId: healthyBuckId,
      targetInterfaceId: "elec-buck-5v-pwr-in",
      connectionType: "power",
      provenance: { method: "user-supplied" },
    });

    const st = useRobotStore.getState();
    const report = validateElectricalAssembly({
      parts: st.parts,
      electricalConnections: st.electricalConnections,
    });
    expect(
      report.diagnostics.some(
        (d) =>
          d.severity === "error" &&
          d.code === "regulator-input-out-of-range" &&
          d.partId === reg7805Id
      )
    ).toBe(true);
    expect(report.powerAnalysis?.consumerStates[badRegSonarId]?.hasPathFault).toBe(true);
    expect(report.powerAnalysis?.consumerStates[healthyBuckId]?.hasPathFault).toBe(false);
    expect(report.powerAnalysis?.consumerStates[healthyBuckId]?.energized).toBe(true);
  });
});
