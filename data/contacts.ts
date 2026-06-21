export type CallMode = "scenario" | "freeplay";

export interface Contact {
  id: string;
  name: string;
  subtitle: string;
  avatar: string;   // 2-char initials OR single emoji
  color: string;    // macOS system color hex for avatar circle
  callable: boolean;
  mode: CallMode;   // "scenario" = scripted demo; "freeplay" = any trained sign speaks live
}

export const CONTACTS: Contact[] = [
  {
    id: "dr-smith",
    name: "Dr. Smith's Office",
    subtitle: "Primary Care",
    avatar: "DS",
    color: "#0A84FF",
    callable: true,
    mode: "scenario",
  },
  {
    id: "testing-call",
    name: "Testing Call",
    subtitle: "Sign playground",
    avatar: "🧪",
    color: "#5E5CE6",
    callable: true,
    mode: "freeplay",
  },
  {
    id: "pharmacy",
    name: "Pharmacy",
    subtitle: "CVS Main St",
    avatar: "💊",
    color: "#30D158",
    callable: false,
    mode: "freeplay",
  },
  {
    id: "mom",
    name: "Mom",
    subtitle: "Mobile",
    avatar: "MO",
    color: "#FF9F0A",
    callable: false,
    mode: "freeplay",
  },
  {
    id: "reservations",
    name: "Reservations",
    subtitle: "Restaurant",
    avatar: "RE",
    color: "#BF5AF2",
    callable: false,
    mode: "freeplay",
  },
  {
    id: "front-desk",
    name: "Front Desk",
    subtitle: "Building",
    avatar: "FD",
    color: "#FF453A",
    callable: false,
    mode: "freeplay",
  },
];

export function getContactById(id: string): Contact | undefined {
  return CONTACTS.find((c) => c.id === id);
}
