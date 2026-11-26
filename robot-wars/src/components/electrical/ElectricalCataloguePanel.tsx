import { useMemo, useState } from "react";
import {
  ELECTRICAL_CATALOGUE_CATEGORY_LABELS,
  electricalCatalogue,
} from "../../features/electrical/data/electricalCatalogue";
import { resolvePartElectricalSpec } from "../../features/electrical/logic/electricalComponentAdapters";
import type {
  ElectricalCatalogueCategory,
  ElectricalConnection,
  ElectricalDiagnostic,
} from "../../features/electrical/types/electrical.types";
import type { RobotPart } from "../../features/robot-builder/types/robot.types";

interface ElectricalCataloguePanelProps {
  readonly parts: readonly RobotPart[];
  readonly electricalConnections: readonly ElectricalConnection[];
  readonly diagnostics: readonly ElectricalDiagnostic[];
  readonly selectedId: string | null;
  readonly onSelectPart: (partId: string) => void;
  readonly onInstallCatalogueItem: (
    catalogueId: string,
    options?: { parentId?: string }
  ) => string | null;
  readonly onReplaceElectricalComponent: (
    partId: string,
    catalogueId: string
  ) => boolean;
  readonly onRemovePart: (partId: string) => void;
}

const CATEGORIES: readonly ("all" | ElectricalCatalogueCategory)[] = [
  "all",
  "power",
  "motor-control",
  "controllers",
  "sensors",
  "actuators",
  "connectivity",
];

export default function ElectricalCataloguePanel({
  parts,
  electricalConnections,
  diagnostics,
  selectedId,
  onSelectPart,
  onInstallCatalogueItem,
  onReplaceElectricalComponent,
  onRemovePart,
}: ElectricalCataloguePanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | ElectricalCatalogueCategory
  >("all");
  const [expandedCatalogueId, setExpandedCatalogueId] = useState<string>(
    electricalCatalogue[0]?.id ?? ""
  );
  const [mountParentId, setMountParentId] = useState<string>("foundation-chassis");

  const installedElectricalParts = useMemo(
    () =>
      parts
        .map((part) => ({ part, spec: resolvePartElectricalSpec(part) }))
        .filter((entry): entry is { part: RobotPart; spec: NonNullable<typeof entry.spec> } =>
          Boolean(entry.spec)
        ),
    [parts]
  );

  const selectedIsElectrical = installedElectricalParts.some(
    (entry) => entry.part.id === selectedId
  );

  const mechanicalParents = useMemo(
    () =>
      parts.filter(
        (p) =>
          p.id === "foundation-chassis" ||
          p.type === "Structural Block" ||
          p.type === "Armor Plate"
      ),
    [parts]
  );

  const filteredCatalogue = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return electricalCatalogue.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.componentType.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, categoryFilter]);

  const effectiveParentId = mechanicalParents.some((p) => p.id === mountParentId)
    ? mountParentId
    : mechanicalParents[0]?.id;

  return (
    <aside className="left-panel electrical-left-panel">
      <div className="panel-heading">
        INSTALLED ELECTRONICS ({installedElectricalParts.length})
      </div>
      <div className="panel-content electrical-installed-list">
        {installedElectricalParts.length === 0 ? (
          <p className="builder-intro">
            No electrical components installed yet. Add a battery, controller, driver, or sensor below.
          </p>
        ) : (
          <div className="workshop-compat-checks">
            {installedElectricalParts.map(({ part, spec }) => {
              const partConns = electricalConnections.filter(
                (c) => c.sourcePartId === part.id || c.targetPartId === part.id
              );
              const connectedPins = new Set<string>();
              for (const c of partConns) {
                if (c.sourcePartId === part.id) {
                  connectedPins.add(c.sourcePinId ?? c.sourceInterfaceId);
                }
                if (c.targetPartId === part.id) {
                  connectedPins.add(c.targetPinId ?? c.targetInterfaceId);
                }
              }
              const partDiags = diagnostics.filter(
                (d) => d.partId === part.id || d.relatedPartId === part.id
              );
              const hasError = partDiags.some((d) => d.severity === "error");
              const hasWarn = partDiags.some((d) => d.severity === "warning");
              const unpowered = partDiags.some(
                (d) => d.code === "missing-power-connection"
              );
              const isSelected = selectedId === part.id;

              return (
                <div
                  key={part.id}
                  className={`electrical-installed-item ${isSelected ? "selected" : ""} ${
                    hasError ? "error" : hasWarn ? "warning" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="electrical-installed-select"
                    onClick={() => onSelectPart(part.id)}
                  >
                    <div className="electrical-installed-top">
                      <strong>{part.name}</strong>
                      <span
                        className={`electrical-badge ${
                          hasError ? "error" : hasWarn ? "warning" : "ok"
                        }`}
                      >
                        {hasError ? "ERR" : hasWarn ? "WARN" : "OK"}
                      </span>
                    </div>
                    <small className="workshop-compat-hint">
                      {spec.componentType} · {connectedPins.size}/{spec.pins.length} pins ·{" "}
                      {partConns.length} wire{partConns.length === 1 ? "" : "s"}
                      {unpowered ? " · Unpowered" : ""}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="sim-clear-selection-btn"
                    onClick={() => onRemovePart(part.id)}
                    title={`Remove ${part.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel-heading">ELECTRICAL CATALOGUE ({filteredCatalogue.length})</div>
      <div className="panel-content electrical-catalogue-scroll">
        <input
          type="search"
          aria-label="Search electrical catalogue"
          className="electrical-search-input"
          placeholder="Search batteries, drivers, MCUs, sensors..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div className="workshop-filter-chips" style={{ marginTop: 8, marginBottom: 8 }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`workshop-chip ${categoryFilter === cat ? "active" : ""}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === "all" ? "All" : ELECTRICAL_CATALOGUE_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {mechanicalParents.length > 0 && (
          <label className="inspector-inline-field" style={{ marginBottom: 8 }}>
            <span>Mount Target</span>
            <select
              aria-label="Mechanical mount parent"
              value={effectiveParentId ?? ""}
              onChange={(e) => setMountParentId(e.target.value)}
            >
              {mechanicalParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="catalogue-list">
          {filteredCatalogue.map((item) => {
            const isExpanded = expandedCatalogueId === item.id;
            const tpl = item.electricalSpecTemplate;
            return (
              <div
                key={item.id}
                className={`catalogue-card ${isExpanded ? "active" : ""}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedCatalogueId((prev) =>
                      prev === item.id ? "" : item.id
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedCatalogueId((prev) =>
                        prev === item.id ? "" : item.id
                      );
                    }
                  }}
                >
                  <div className="catalogue-header">
                    <span
                      className="swatch"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="catalogue-name">{item.name}</span>
                  </div>
                  <div className="catalogue-meta">
                    <span>{ELECTRICAL_CATALOGUE_CATEGORY_LABELS[item.category]}</span>
                    <span>{tpl.pins.length} pins</span>
                    <span>{item.provenance.method}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="electrical-cat-details">
                    <p className="catalogue-description">{item.description}</p>
                    <small className="workshop-compat-hint">
                      Interfaces: {tpl.interfaces.length} · Connectors:{" "}
                      {tpl.connectors.length} · Mass: {(item.massKg * 1000).toFixed(0)}g
                    </small>
                    {tpl.unknownFields.length > 0 && (
                      <small className="workshop-compat-hint" style={{ color: "#fbbf24" }}>
                        Unspecified: {tpl.unknownFields.join(", ")}
                      </small>
                    )}
                    {item.datasheetUrl && (
                      <a
                        className="electrical-datasheet-link"
                        href={item.datasheetUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Official Datasheet ↗
                      </a>
                    )}
                    <div className="electrical-cat-actions">
                      <button
                        type="button"
                        className="build-button"
                        onClick={() =>
                          onInstallCatalogueItem(item.id, {
                            parentId: effectiveParentId,
                          })
                        }
                      >
                        + Install
                      </button>
                      {selectedIsElectrical && selectedId && (
                        <button
                          type="button"
                          className="top-button"
                          onClick={() =>
                            onReplaceElectricalComponent(selectedId, item.id)
                          }
                          title="Safely replace currently selected electrical component"
                        >
                          Replace Selected
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
