export interface RecentCall {
  contactId: string;
  contactName: string;
  timestamp: number;  // Date.now()
  duration: number;   // seconds
  outcome: "completed" | "cancelled";
}

const KEY = "pwh-recents";

export function getRecents(): RecentCall[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentCall[];
  } catch {
    return [];
  }
}

export function logCall(entry: RecentCall): void {
  if (typeof window === "undefined") return;
  try {
    const list = getRecents();
    list.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // localStorage unavailable in this context
  }
}
