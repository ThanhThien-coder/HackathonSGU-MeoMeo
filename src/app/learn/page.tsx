import type { Metadata } from "next";
import { Suspense } from "react";
import { Boot } from "@/components/layout/Boot";
import { LearnShell } from "@/components/learn/LearnShell";

export const metadata: Metadata = { title: "Trang học · SimpliFey" };

export default function LearnPage() {
  return (
    <>
      <Boot />
      <Suspense fallback={null}>
        <LearnShell />
      </Suspense>
    </>
  );
}
