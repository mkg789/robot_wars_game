import { Euler, Vector3 } from "three";
import {
  getPartBoundingExtents,
  getPartBoxExtents,
} from "./geometryAdapters";
import type {
  AttachmentCompatibilityStatus,
  AttachmentInterface,
  AttachmentInterfaceKind,
  FoundationConfig,
  RobotConnection,
  RobotPart,
} from "../types/robot.types";

export interface InterfaceCompatibilityResult {
  readonly status: AttachmentCompatibilityStatus;
  readonly reason: string;
}

export interface AttachedTransformResult {
  readonly relativePosition: [number, number, number];
  readonly relativeRotation: [number, number, number];
  readonly worldPosition: [number, number, number];
  readonly worldRotation: [number, number, number];
}

const KNOWN_COMPATIBILITY: Readonly<
  Record<AttachmentInterfaceKind, readonly AttachmentInterfaceKind[]>
> = {
  "foundation-deck": [
    "plate-mount",
    "bracket-face",
    "rail-slot",
    "generic-structural",
  ],
  "foundation-rail": [
    "rail-slot",
    "bracket-face",
    "generic-structural",
    "motor-mount",
  ],
  "foundation-bumper": ["generic-structural", "bracket-face"],
  "rail-slot": [
    "rail-slot",
    "bracket-face",
    "plate-mount",
    "generic-structural",
    "motor-mount",
  ],
  "bracket-face": [
    "bracket-face",
    "rail-slot",
    "plate-mount",
    "foundation-deck",
    "foundation-rail",
    "foundation-bumper",
    "generic-structural",
    "motor-mount",
  ],
  "plate-mount": [
    "foundation-deck",
    "rail-slot",
    "bracket-face",
    "plate-mount",
    "generic-structural",
  ],
  "motor-mount": ["wheel-hub", "foundation-rail", "rail-slot", "bracket-face"],
  "wheel-hub": ["motor-mount"],
  "generic-structural": [
    "foundation-deck",
    "foundation-rail",
    "foundation-bumper",
    "rail-slot",
    "bracket-face",
    "plate-mount",
    "generic-structural",
  ],
  unknown: [],
};

/**
 * Evaluates compatibility between a parent interface and a child interface without
 * fabricating engineering certainty when metadata or interface kind is unknown.
 */
export function evaluateInterfaceCompatibility(
  parentInterface: AttachmentInterface | null | undefined,
  childInterface: AttachmentInterface | null | undefined
): InterfaceCompatibilityResult {
  if (!parentInterface || !childInterface) {
    return {
      status: "unknown",
      reason: "Mounting interface metadata unavailable; compatibility is unverified.",
    };
  }

  if (
    parentInterface.kind === "unknown" ||
    childInterface.kind === "unknown" ||
    parentInterface.compatibilityStatus === "unknown" ||
    childInterface.compatibilityStatus === "unknown"
  ) {
    return {
      status: "unknown",
      reason: `Compatibility between "${parentInterface.label}" and "${childInterface.label}" is unverified.`,
    };
  }

  const parentAcceptsChild =
    parentInterface.compatibleWith.includes(childInterface.kind) ||
    KNOWN_COMPATIBILITY[parentInterface.kind]?.includes(childInterface.kind);
  const childAcceptsParent =
    childInterface.compatibleWith.includes(parentInterface.kind) ||
    KNOWN_COMPATIBILITY[childInterface.kind]?.includes(parentInterface.kind);

  if (parentAcceptsChild && childAcceptsParent) {
    return {
      status: "compatible",
      reason: `"${parentInterface.label}" matches "${childInterface.label}".`,
    };
  }

  return {
    status: "incompatible",
    reason: `Interface "${parentInterface.kind}" is incompatible with "${childInterface.kind}".`,
  };
}

/**
 * Generates reusable local attachment interfaces anchored on a foundation chassis.
 */
export function getFoundationMountingInterfaces(
  foundation: FoundationConfig
): AttachmentInterface[] {
  const halfL = foundation.length * 0.5;
  const halfH = foundation.height * 0.5;
  const halfW = foundation.width * 0.5;
  const topSurfaceLocalY = foundation.includeTopPlate
    ? halfH + 0.15
    : halfH;

  return [
    {
      id: "foundation-top-center",
      label: "Deck Center Mount",
      kind: "foundation-deck",
      position: [0, topSurfaceLocalY, 0],
      rotation: [0, 0, 0],
      compatibleWith: ["plate-mount", "bracket-face", "rail-slot", "generic-structural"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-top-front",
      label: "Front Deck Bay",
      kind: "foundation-deck",
      position: [halfL * 0.45, topSurfaceLocalY, 0],
      rotation: [0, 0, 0],
      compatibleWith: ["plate-mount", "bracket-face", "rail-slot", "generic-structural"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-top-rear",
      label: "Rear Deck Bay",
      kind: "foundation-deck",
      position: [-halfL * 0.45, topSurfaceLocalY, 0],
      rotation: [0, 0, 0],
      compatibleWith: ["plate-mount", "bracket-face", "rail-slot", "generic-structural"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-front-face",
      label: "Front Bumper Face (+X)",
      kind: "foundation-bumper",
      position: [halfL, 0, 0],
      rotation: [0, 0, 0],
      compatibleWith: ["generic-structural", "bracket-face"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-rear-face",
      label: "Rear Bumper Face (-X)",
      kind: "foundation-bumper",
      position: [-halfL, 0, 0],
      rotation: [0, Math.PI, 0],
      compatibleWith: ["generic-structural", "bracket-face"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-left-rail",
      label: "Left Side Rail (+Z)",
      kind: "foundation-rail",
      position: [0, halfH * 0.35, halfW],
      rotation: [0, -Math.PI / 2, 0],
      compatibleWith: ["rail-slot", "bracket-face", "generic-structural", "motor-mount"],
      compatibilityStatus: "compatible",
    },
    {
      id: "foundation-right-rail",
      label: "Right Side Rail (-Z)",
      kind: "foundation-rail",
      position: [0, halfH * 0.35, -halfW],
      rotation: [0, Math.PI / 2, 0],
      compatibleWith: ["rail-slot", "bracket-face", "generic-structural", "motor-mount"],
      compatibilityStatus: "compatible",
    },
  ];
}

/**
 * Resolves available mounting interfaces in a part's local coordinate frame
 * based on canonical component dimensions and structural category.
 */
export function resolvePartMountingInterfaces(
  part: RobotPart,
  foundation?: FoundationConfig | null
): AttachmentInterface[] {
  if (part.id === "foundation-chassis" && foundation) {
    return getFoundationMountingInterfaces(foundation);
  }

  const extents =
    part.geometry?.shape === "cylinder"
      ? getPartBoundingExtents(part)
      : getPartBoxExtents(part);
  const [lx, hy, wz] = extents;
  const hx = lx * 0.5;
  const hhy = hy * 0.5;
  const hz = wz * 0.5;

  if (part.type === "Motor") {
    return [
      {
        id: "motor-mount",
        label: "Motor Housing Base",
        kind: "motor-mount",
        position: [0, -hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["foundation-rail", "rail-slot", "bracket-face"],
        compatibilityStatus: "compatible",
      },
      {
        id: "motor-shaft",
        label: "Motor Output Shaft",
        kind: "motor-mount",
        position: [hx + lx * 0.55, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["wheel-hub"],
        compatibilityStatus: "compatible",
      },
    ];
  }

  if (part.type === "Wheel") {
    return [
      {
        id: "wheel-hub",
        label: "Wheel Hub Bore",
        kind: "wheel-hub",
        position: [-hx, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["motor-mount"],
        compatibilityStatus: "compatible",
      },
    ];
  }

  if (part.type === "Battery" || part.type === "Controller") {
    return [
      {
        id: "component-base",
        label: "Bottom Mounting Pad",
        kind: "plate-mount",
        position: [0, -hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: [
          "foundation-deck",
          "plate-mount",
          "rail-slot",
          "generic-structural",
        ],
        compatibilityStatus: "compatible",
      },
    ];
  }

  if (part.type === "Front Bumper" || part.structuralCategory === "bumper") {
    return [
      {
        id: "bumper-rear-mount",
        label: "Rear Mounting Face (-X)",
        kind: "generic-structural",
        position: [-hx, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["foundation-bumper", "bracket-face", "rail-slot", "generic-structural"],
        compatibilityStatus: "compatible",
      },
      {
        id: "bumper-top-mount",
        label: "Top Flange (+Y)",
        kind: "plate-mount",
        position: [0, hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["bracket-face", "generic-structural"],
        compatibilityStatus: "compatible",
      },
    ];
  }

  if (part.structuralCategory === "rail" || part.structuralCategory === "beam" || part.structuralCategory === "crossbar") {
    const kind: AttachmentInterfaceKind = "rail-slot";
    return [
      {
        id: "rail-bottom",
        label: "Bottom Mounting Face",
        kind,
        position: [0, -hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["foundation-deck", "foundation-rail", "bracket-face", "plate-mount", "rail-slot", "generic-structural"],
        compatibilityStatus: "compatible",
      },
      {
        id: "rail-top",
        label: "Top Slot Channel",
        kind,
        position: [0, hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["bracket-face", "plate-mount", "rail-slot", "motor-mount", "generic-structural"],
        compatibilityStatus: "compatible",
      },
      {
        id: "rail-front-end",
        label: "Front End Cap (+X)",
        kind,
        position: [hx, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["bracket-face", "rail-slot", "generic-structural"],
        compatibilityStatus: "compatible",
      },
      {
        id: "rail-rear-end",
        label: "Rear End Cap (-X)",
        kind,
        position: [-hx, 0, 0],
        rotation: [0, Math.PI, 0],
        compatibleWith: ["bracket-face", "rail-slot", "generic-structural"],
        compatibilityStatus: "compatible",
      },
    ];
  }

  if (part.structuralCategory === "bracket") {
    return [
      {
        id: "bracket-base",
        label: "Bracket Base Face (-Y)",
        kind: "bracket-face",
        position: [0, -hhy, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["foundation-deck", "foundation-rail", "rail-slot", "plate-mount", "generic-structural"],
        compatibilityStatus: "compatible",
      },
      {
        id: "bracket-side-flange",
        label: "Vertical Flange (+X)",
        kind: "bracket-face",
        position: [hx, 0, 0],
        rotation: [0, 0, 0],
        compatibleWith: ["rail-slot", "plate-mount", "motor-mount", "generic-structural"],
        compatibilityStatus: "compatible",
      },
    ];
  }

  // Generic plate / spacer / standoff / structural block / armor plate
  const genericKind: AttachmentInterfaceKind =
    part.type === "Armor Plate" || part.structuralCategory === "plate"
      ? "plate-mount"
      : "generic-structural";
  return [
    {
      id: "mount-bottom",
      label: "Bottom Surface (-Y)",
      kind: genericKind,
      position: [0, -hhy, 0],
      rotation: [0, 0, 0],
      compatibleWith: [
        "foundation-deck",
        "foundation-rail",
        "rail-slot",
        "bracket-face",
        "plate-mount",
        "generic-structural",
      ],
      compatibilityStatus: "compatible",
    },
    {
      id: "mount-top",
      label: "Top Surface (+Y)",
      kind: genericKind,
      position: [0, hhy, 0],
      rotation: [0, 0, 0],
      compatibleWith: [
        "plate-mount",
        "bracket-face",
        "rail-slot",
        "generic-structural",
      ],
      compatibilityStatus: "compatible",
    },
    {
      id: "mount-left",
      label: "Side Face (+Z)",
      kind: "generic-structural",
      position: [0, 0, hz],
      rotation: [0, -Math.PI / 2, 0],
      compatibleWith: ["bracket-face", "rail-slot", "generic-structural"],
      compatibilityStatus: "compatible",
    },
    {
      id: "mount-right",
      label: "Side Face (-Z)",
      kind: "generic-structural",
      position: [0, 0, -hz],
      rotation: [0, Math.PI / 2, 0],
      compatibleWith: ["bracket-face", "rail-slot", "generic-structural"],
      compatibilityStatus: "compatible",
    },
  ];
}

/**
 * Checks whether connecting `parentId -> childId` introduces a parent-child cycle.
 */
export function hasAttachmentCycle(
  connections: readonly RobotConnection[],
  parentId: string,
  childId: string
): boolean {
  if (parentId === childId) return true;
  let current = parentId;
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);
    if (current === childId) return true;
    const parentLink = connections.find(
      (conn) => (conn.childId ?? conn.targetId) === current
    );
    current = parentLink ? parentLink.parentId ?? parentLink.sourceId : "";
  }
  return false;
}

/**
 * Computes relative & world transforms so that `childPart`'s mounting interface
 * rests flush at `parentPart`'s selected attachment interface.
 */
export function computeAttachedChildTransform(
  parentPart: RobotPart,
  parentInterface: AttachmentInterface,
  childPart: RobotPart,
  childInterface: AttachmentInterface
): AttachedTransformResult {
  const relativeRotation: [number, number, number] = [
    parentInterface.rotation[0] - childInterface.rotation[0],
    parentInterface.rotation[1] - childInterface.rotation[1],
    parentInterface.rotation[2] - childInterface.rotation[2],
  ];

  const rotatedChildOffset = new Vector3(...childInterface.position).applyEuler(
    new Euler(...relativeRotation, "XYZ")
  );

  const relativePosition: [number, number, number] = [
    parentInterface.position[0] - rotatedChildOffset.x,
    parentInterface.position[1] - rotatedChildOffset.y,
    parentInterface.position[2] - rotatedChildOffset.z,
  ];

  const worldOffset = new Vector3(...relativePosition).applyEuler(
    new Euler(...(parentPart.rotation ?? [0, 0, 0]), "XYZ")
  );

  const worldPosition: [number, number, number] = [
    parentPart.position[0] + worldOffset.x,
    parentPart.position[1] + worldOffset.y,
    parentPart.position[2] + worldOffset.z,
  ];

  const worldRotation: [number, number, number] = [
    (parentPart.rotation?.[0] ?? 0) + relativeRotation[0],
    (parentPart.rotation?.[1] ?? 0) + relativeRotation[1],
    (parentPart.rotation?.[2] ?? 0) + relativeRotation[2],
  ];

  void childPart;
  return {
    relativePosition,
    relativeRotation,
    worldPosition,
    worldRotation,
  };
}

/**
 * Converts a child's current world transform into parent-relative coordinates so manual
 * position/rotation tweaks can persist seamlessly in RobotConnection.
 */
export function computeRelativeTransformBetweenParts(
  parentPart: RobotPart,
  childWorldPosition: readonly [number, number, number],
  childWorldRotation: readonly [number, number, number]
): {
  readonly relativePosition: [number, number, number];
  readonly relativeRotation: [number, number, number];
} {
  const parentEuler = new Euler(...(parentPart.rotation ?? [0, 0, 0]), "XYZ");
  const inverseQuaternion = new Vector3(
    childWorldPosition[0] - parentPart.position[0],
    childWorldPosition[1] - parentPart.position[1],
    childWorldPosition[2] - parentPart.position[2]
  ).applyEuler(
    new Euler(-parentEuler.x, -parentEuler.y, -parentEuler.z, "ZYX")
  );

  return {
    relativePosition: [
      inverseQuaternion.x,
      inverseQuaternion.y,
      inverseQuaternion.z,
    ],
    relativeRotation: [
      childWorldRotation[0] - (parentPart.rotation?.[0] ?? 0),
      childWorldRotation[1] - (parentPart.rotation?.[1] ?? 0),
      childWorldRotation[2] - (parentPart.rotation?.[2] ?? 0),
    ],
  };
}
