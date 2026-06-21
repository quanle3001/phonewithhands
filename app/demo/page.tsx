import { redirect } from "next/navigation";

// /demo kept for backwards compatibility — forwards to the wired call route.
export default function DemoPage() {
  redirect("/call/dr-smith");
}
