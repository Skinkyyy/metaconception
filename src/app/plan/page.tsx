import type { Metadata } from "next";
import { Suspense } from "react";
import PlanEditor from "@/components/PlanEditor";

export const metadata: Metadata = {
  title: "Plan de masse — Metaconception",
};

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#0d1a10]" />}>
      <PlanEditor />
    </Suspense>
  );
}
