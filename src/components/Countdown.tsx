"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { timeLeft } from "@/lib/format.ts";

export default function Countdown({ endsAt, refreshOnEnd = false }: { endsAt: number; refreshOnEnd?: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now == null ? null : endsAt - now;
  useEffect(() => {
    if (refreshOnEnd && left != null && left <= 0 && left > -2000) router.refresh();
  }, [left, refreshOnEnd, router]);
  const urgent = left != null && left > 0 && left < 3_600_000;
  return (
    <span className="countdown" style={urgent ? { color: "var(--accent)" } : undefined} suppressHydrationWarning>
      {left == null ? "…" : timeLeft(left)}
    </span>
  );
}
