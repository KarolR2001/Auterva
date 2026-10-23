const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const FIXTURE = {
  organizations: [id(1), id(2)],
  users: ["fixture-admin-a", "fixture-admin-b", "fixture-superadmin"],
  vehicles: [id(21), id(22), id(23), id(24), id(25), id(26)],
  conversations: [id(61), id(62)],
} as const;

export { id as fixtureId };
