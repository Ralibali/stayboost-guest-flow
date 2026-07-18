/**
 * Personalresurser — team, roller och tilldelning (BookSpot: "Assigned staff").
 * Modul-nivå state så tilldelningen lever kvar i demosessionen.
 */

export type StaffRole = "Städ" | "Frukost" | "Reception";

export type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  phone: string;
  color: string;
  weeklyShifts: boolean[]; // mån–sön
};

export const STAFF: StaffMember[] = [
  {
    id: "maria",
    name: "Maria Sandberg",
    role: "Städ",
    phone: "070-111 22 33",
    color: "#7c5cbf",
    weeklyShifts: [true, true, true, false, true, false, false],
  },
  {
    id: "ahmed",
    name: "Ahmed Hassan",
    role: "Städ",
    phone: "073-444 55 66",
    color: "#2e7d4f",
    weeklyShifts: [false, true, true, true, false, true, false],
  },
  {
    id: "lisa",
    name: "Lisa Holmberg",
    role: "Frukost",
    phone: "076-777 88 99",
    color: "#b08d3e",
    weeklyShifts: [true, true, true, true, true, false, false],
  },
  {
    id: "agare",
    name: "Du (ägaren)",
    role: "Reception",
    phone: "070-000 00 00",
    color: "#1e3a2d",
    weeklyShifts: [true, true, true, true, true, true, true],
  },
];

export const staffById = (id: string) => STAFF.find((s) => s.id === id)!;

/** Uppgift → personal. Nycklar: "stad-<unitId>", "frukost", "manifest-prep". */
const assignments: Record<string, string> = {
  "stad-vindraget": "maria",
  "stad-kanaltaltet": "ahmed",
  "stad-slussvaktaren": "maria",
  frukost: "lisa",
  "manifest-prep": "agare",
};

export const getAssigneeId = (taskKey: string) => assignments[taskKey] ?? "agare";
export const getAssignee = (taskKey: string) => staffById(getAssigneeId(taskKey));
export const setAssignee = (taskKey: string, staffId: string) => {
  assignments[taskKey] = staffId;
};

/** Alla städuppgifter som ska fördelas. */
export const CLEANING_TASK_KEYS = ["stad-vindraget", "stad-kanaltaltet", "stad-slussvaktaren"];
