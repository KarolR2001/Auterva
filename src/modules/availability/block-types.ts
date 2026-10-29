export const blockTypes = ["RESERVED", "MAINTENANCE", "BLOCKED", "OTHER"] as const;
export type BlockType = (typeof blockTypes)[number];
/** D-15: the canonical service type is MAINTENANCE, shown as "Serwis". */
export const blockTypeLabels: Record<BlockType, string> = {
  RESERVED: "Zarezerwowane", MAINTENANCE: "Serwis", BLOCKED: "Zablokowane", OTHER: "Inne",
};
