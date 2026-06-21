export interface Contact {
  id: string;
  name: string;
  subtitle: string;
  avatar: string;   // 2-char initials OR single emoji
  color: string;    // macOS system color hex for avatar circle
  callable: boolean;
}

export const CONTACTS: Contact[] = [
  {
    id: "dr-smith",
    name: "Dr. Smith's Office",
    subtitle: "Primary Care",
    avatar: "DS",
    color: "#0A84FF",
    callable: true,
  },
  {
    id: "pharmacy",
    name: "Pharmacy",
    subtitle: "CVS Main St",
    avatar: "💊",
    color: "#30D158",
    callable: false,
  },
  {
    id: "mom",
    name: "Mom",
    subtitle: "Mobile",
    avatar: "MO",
    color: "#FF9F0A",
    callable: false,
  },
  {
    id: "reservations",
    name: "Reservations",
    subtitle: "Restaurant",
    avatar: "RE",
    color: "#BF5AF2",
    callable: false,
  },
  {
    id: "front-desk",
    name: "Front Desk",
    subtitle: "Building",
    avatar: "FD",
    color: "#FF453A",
    callable: false,
  },
];

export function getContactById(id: string): Contact | undefined {
  return CONTACTS.find((c) => c.id === id);
}
