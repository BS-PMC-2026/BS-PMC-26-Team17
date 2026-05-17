export type ShelterStatus = "open" | "full" | "closed" | "locked";

export const SHELTER_STATUS_COLORS: Record<ShelterStatus, string> = {
  open: "#1D9E75",
  full: "#F5A623",
  closed: "#E24B4A",
  locked: "#E24B4A",
};
