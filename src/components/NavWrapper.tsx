"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";

const TOOL_PATHS = ["/plan", "/plu"];

export default function NavWrapper() {
  const pathname = usePathname();
  if (TOOL_PATHS.some(p => pathname.startsWith(p))) return null;
  return <Nav />;
}
