"use client";

import { useMemo } from "react";
import {
  colorWithAlpha,
  type SheetAnimator,
  type SheetStatus,
  type SheetShot,
} from "@/lib/sheets";

interface Props {
  animators: SheetAnimator[];
  statuses: SheetStatus[];
  shots: SheetShot[];
}

export default function SummaryPanel({ animators, statuses, shots }: Props) {
  const { perAnimator, statusTotals, grandFrames, grandShots } = useMemo(() => {
    const perAnimator = new Map<
      string,
      { counts: Map<string, number>; totalShots: number; totalFrames: number }
    >();

    for (const a of animators) {
      perAnimator.set(a.id, { counts: new Map(), totalShots: 0, totalFrames: 0 });
    }

    const statusTotals = new Map<string, number>();
    let grandFrames = 0;
    let grandShots = 0;

    for (const shot of shots) {
      grandShots += 1;
      grandFrames += shot.frame_count || 0;

      if (shot.status_id) {
        statusTotals.set(shot.status_id, (statusTotals.get(shot.status_id) ?? 0) + 1);
      }

      if (shot.animator_id && perAnimator.has(shot.animator_id)) {
        const rec = perAnimator.get(shot.animator_id)!;
        rec.totalShots += 1;
        rec.totalFrames += shot.frame_count || 0;
        if (shot.status_id) {
          rec.counts.set(shot.status_id, (rec.counts.get(shot.status_id) ?? 0) + 1);
        }
      }
    }

    return { perAnimator, statusTotals, grandFrames, grandShots };
  }, [animators, shots]);

  if (animators.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] py-10 text-center text-[13px] text-white/35">
        Özet için önce ayarlardan animatör ekleyin.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Genel durum şeridi */}
      <div className="flex flex-wrap gap-2">
        <StatPill label="Toplam Shot" value={grandShots} />
        <StatPill label="Toplam Kare" value={grandFrames} />
        {statuses.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-xl border px-3 py-2"
            style={{
              borderColor: colorWithAlpha(s.color, 0.4),
              background: colorWithAlpha(s.color, 0.12),
            }}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-[12px] text-white/70">{s.name}</span>
            <span className="text-[13px] font-semibold text-white">
              {statusTotals.get(s.id) ?? 0}
            </span>
          </div>
        ))}
      </div>

      {/* Animatör matrisi */}
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-black/25">
              <th className="sticky left-0 z-10 min-w-[140px] bg-[var(--surface-sticky-head)] px-3 py-2.5 text-left font-medium text-white/70">
                Animatör
              </th>
              {statuses.map((s) => (
                <th
                  key={s.id}
                  className="min-w-[64px] px-2 py-2.5 text-center font-medium"
                  style={{ background: colorWithAlpha(s.color, 0.22), color: "#fff" }}
                >
                  {s.name}
                </th>
              ))}
              <th className="min-w-[64px] bg-[var(--surface-elevated)] px-2 py-2.5 text-center font-semibold text-white/80">
                Shot
              </th>
              <th className="min-w-[72px] bg-[var(--surface-elevated)] px-2 py-2.5 text-center font-semibold text-[var(--accent)]">
                Kare
              </th>
            </tr>
          </thead>
          <tbody>
            {animators.map((a) => {
              const rec = perAnimator.get(a.id)!;
              return (
                <tr
                  key={a.id}
                  className="border-t border-[var(--border)] transition-colors hover:bg-white/[0.03]"
                >
                  <td className="sticky left-0 z-10 bg-[var(--surface-sticky-cell)] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: a.color }}
                      />
                      <span className="truncate text-white/85">{a.name}</span>
                    </div>
                  </td>
                  {statuses.map((s) => {
                    const c = rec.counts.get(s.id) ?? 0;
                    return (
                      <td
                        key={s.id}
                        className="px-2 py-2 text-center tabular-nums"
                        style={{
                          color: c > 0 ? "#fff" : "rgba(255,255,255,0.25)",
                          background: c > 0 ? colorWithAlpha(s.color, 0.14) : undefined,
                        }}
                      >
                        {c}
                      </td>
                    );
                  })}
                  <td className="bg-[var(--surface)] px-2 py-2 text-center font-semibold tabular-nums text-white/80">
                    {rec.totalShots}
                  </td>
                  <td className="bg-[var(--surface)] px-2 py-2 text-center font-semibold tabular-nums text-[var(--accent)]">
                    {rec.totalFrames}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2">
      <span className="text-[12px] text-white/55">{label}</span>
      <span className="text-[13px] font-semibold text-white">{value}</span>
    </div>
  );
}
