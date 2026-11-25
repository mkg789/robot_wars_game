import { useMemo, useState } from "react";
import { structuralCatalogue } from "../../features/robot-builder/data/structuralCatalogue";
import { evaluateComponentAttachmentCompatibility } from "../../features/robot-builder/logic/mechanicalCompatibility";
import { resolvePartMountingInterfaces } from "../../features/robot-builder/logic/mountingInterfaces";
import StlImportPanel from "./StlImportPanel";
import type {
  FoundationConfig,
  RobotPart,
  StructuralCatalogueId,
  StructuralCategory,
} from "../../features/robot-builder/types/robot.types";

type CategoryFilter = "all" | StructuralCategory;

const CATEGORY_OPTIONS: ReadonlyArray<{
  readonly id: CategoryFilter;
  readonly label: string;
}> = [
  { id: "all", label: "All" },
  { id: "bracket", label: "Brackets" },
  { id: "rail", label: "Rails & Bars" },
  { id: "plate", label: "Plates" },
  { id: "crossbar", label: "Crossbars" },
  { id: "spacer", label: "Spacers" },
  { id: "beam", label: "Beams" },
  { id: "bumper", label: "Bumpers" },
];

interface StructureStagePanelProps {
  readonly parts: readonly RobotPart[];
  readonly foundation: FoundationConfig | null;
  readonly selectedPart: RobotPart | null;
  readonly selectedCatalogueId: StructuralCatalogueId | null;
  readonly onSelectCatalogueItem: (id: StructuralCatalogueId) => void;
  readonly onAddStructuralPart: (
    id: StructuralCatalogueId,
    options?: {
      parentId?: string;
      parentInterfaceId?: string;
    }
  ) => void;
  readonly onReplaceStructuralPart: (
    partId: string,
    catalogueId: StructuralCatalogueId
  ) => void;
  readonly onDuplicatePart: (partId: string) => void;
  readonly onImportStructuralStl?: (
    payload: Parameters<Parameters<typeof StlImportPanel>[0]["onConfirmImport"]>[0] & {
      parentId?: string;
      parentInterfaceId?: string;
    }
  ) => void;
  readonly onContinueToBattery: () => void;
  readonly onBackToFoundation: () => void;
}

export default function StructureStagePanel({
  parts,
  foundation,
  selectedPart,
  selectedCatalogueId,
  onSelectCatalogueItem,
  onAddStructuralPart,
  onReplaceStructuralPart,
  onDuplicatePart,
  onImportStructuralStl,
  onContinueToBattery,
  onBackToFoundation,
}: StructureStagePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showStlImporter, setShowStlImporter] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedParentId, setSelectedParentId] = useState<string>(
    "foundation-chassis"
  );
  const [selectedParentInterfaceId, setSelectedParentInterfaceId] =
    useState<string>("");

  const mountableParents = useMemo(
    () =>
      parts.filter(
        (p) =>
          p.id === "foundation-chassis" ||
          p.type === "Structural Block" ||
          p.type === "Armor Plate" ||
          p.type === "Front Bumper"
      ),
    [parts]
  );

  const activeParent =
    mountableParents.find((p) => p.id === selectedParentId) ??
    mountableParents[0] ??
    null;

  const parentInterfaces = useMemo(
    () =>
      activeParent
        ? resolvePartMountingInterfaces(activeParent, foundation)
        : [],
    [activeParent, foundation]
  );

  const selectedDefinition =
    structuralCatalogue.find((item) => item.id === selectedCatalogueId) ??
    structuralCatalogue[0];

  const activeParentInterface =
    parentInterfaces.find((i) => i.id === selectedParentInterfaceId) ??
    parentInterfaces[0] ??
    null;

  const previewCompatibility = useMemo(() => {
    if (!activeParent || !activeParentInterface || !selectedDefinition) return null;
    const dummyChild: RobotPart = {
      id: "preview",
      name: selectedDefinition.name,
      type: selectedDefinition.componentType,
      structuralCatalogueId: selectedDefinition.id,
      structuralCategory: selectedDefinition.category,
      structuralVisualShape: selectedDefinition.visualShape,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [
        selectedDefinition.dimensions.length,
        selectedDefinition.dimensions.height,
        selectedDefinition.dimensions.width,
      ],
      color: selectedDefinition.color,
      mass: selectedDefinition.massKg,
      massKg: selectedDefinition.massKg,
      geometry: selectedDefinition.geometry,
      engineeringSpec: selectedDefinition.engineeringSpec,
    };
    const childInterfaces = resolvePartMountingInterfaces(
      dummyChild,
      foundation
    );
    return evaluateComponentAttachmentCompatibility({
      childPart: dummyChild,
      parentPart: activeParent,
      parentInterface: activeParentInterface,
      childInterface: childInterfaces[0],
      foundation,
    });
  }, [activeParent, activeParentInterface, selectedDefinition, foundation]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return structuralCatalogue.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, categoryFilter]);

  const installedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of parts) {
      if (part.structuralCatalogueId) {
        counts.set(
          part.structuralCatalogueId,
          (counts.get(part.structuralCatalogueId) ?? 0) + 1
        );
      }
    }
    return counts;
  }, [parts]);

  const canReplaceSelected = Boolean(
    selectedPart &&
      selectedDefinition &&
      !selectedPart.id.startsWith("foundation-") &&
      selectedPart.type !== "Motor" &&
      selectedPart.type !== "Wheel" &&
      selectedPart.type !== "Battery" &&
      selectedPart.type !== "Controller"
  );

  return (
    <>
      <div className="section-label">STRUCTURAL CATALOGUE</div>
      <input
        type="search"
        className="workshop-search-input"
        aria-label="Search structural components"
        placeholder="Search brackets, rails, plates..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <div className="workshop-filter-chips" role="group" aria-label="Filter structural category">
        {CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`workshop-chip ${categoryFilter === opt.id ? "active" : ""}`}
            onClick={() => setCategoryFilter(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="motor-list workshop-structural-list">
        {filteredItems.map((item) => {
          const count = installedCounts.get(item.id) ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              className={`motor-card ${selectedCatalogueId === item.id ? "selected" : ""}`}
              onClick={() => onSelectCatalogueItem(item.id)}
            >
              <span
                className="motor-card-icon"
                style={{ borderColor: item.color }}
              >
                ⊞
              </span>
              <span className="workshop-card-body">
                <strong>
                  {item.name}
                  {count > 0 && <span className="workshop-installed-pill">×{count}</span>}
                </strong>
                <small>
                  {item.dimensions.length.toFixed(2)}×{item.dimensions.height.toFixed(2)}×
                  {item.dimensions.width.toFixed(2)} m · {item.massKg.toFixed(2)} kg
                </small>
              </span>
            </button>
          );
        })}
        {filteredItems.length === 0 && (
          <p className="builder-intro">No structural parts match "{searchQuery}".</p>
        )}
      </div>

      {activeParent && (
        <div className="workshop-mount-target">
          <div className="section-label">MOUNT TARGET</div>
          <label className="sim-select-field">
            <span>Parent Assembly</span>
            <select
              aria-label="Mount parent assembly"
              value={activeParent.id}
              onChange={(e) => {
                setSelectedParentId(e.target.value);
                setSelectedParentInterfaceId("");
              }}
            >
              {mountableParents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
            </select>
          </label>
          {parentInterfaces.length > 0 && (
            <label className="sim-select-field">
              <span>Mounting Point</span>
              <select
                aria-label="Mount parent interface"
                value={activeParentInterface?.id ?? ""}
                onChange={(e) => setSelectedParentInterfaceId(e.target.value)}
              >
                {parentInterfaces.map((iface) => (
                  <option key={iface.id} value={iface.id}>
                    {iface.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {previewCompatibility && (
            <>
              <div
                className={`workshop-compat-pill ${previewCompatibility.status}`}
                title={previewCompatibility.summary}
              >
                Mount Check: {previewCompatibility.status.replace(/-/g, " ").toUpperCase()} ·{" "}
                {previewCompatibility.provenanceState}
              </div>
              <p className="builder-intro" style={{ marginTop: 4, marginBottom: 0 }}>
                {previewCompatibility.summary}
              </p>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        className="primary-button foundation-confirm"
        disabled={!selectedDefinition}
        onClick={() => {
          if (!selectedDefinition) return;
          onAddStructuralPart(selectedDefinition.id, {
            parentId: activeParent?.id,
            parentInterfaceId: activeParentInterface?.id,
          });
        }}
      >
        Add {selectedDefinition?.name ?? "Part"}
      </button>

      {canReplaceSelected && selectedPart && selectedDefinition && (
        <div className="workshop-inline-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onReplaceStructuralPart(selectedPart.id, selectedDefinition.id)
            }
          >
            Replace "{selectedPart.name}"
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onDuplicatePart(selectedPart.id)}
          >
            Duplicate Selected
          </button>
        </div>
      )}

      {onImportStructuralStl && (
        <div className="workshop-mount-target">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowStlImporter((v) => !v)}
          >
            {showStlImporter ? "Hide STL Importer" : "+ Import Custom STL Component"}
          </button>
          {showStlImporter && (
            <div style={{ marginTop: 8 }}>
              <StlImportPanel
                targetKind="structural"
                onConfirmImport={(payload) => {
                  onImportStructuralStl({
                    ...payload,
                    parentId: activeParent?.id,
                    parentInterfaceId: activeParentInterface?.id,
                  });
                  setShowStlImporter(false);
                }}
                onCancel={() => setShowStlImporter(false)}
              />
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="stage-back-button"
        onClick={onContinueToBattery}
      >
        Continue to Battery
      </button>
      <button
        type="button"
        className="stage-back-button"
        onClick={onBackToFoundation}
      >
        ← Back to Foundation
      </button>
    </>
  );
}
