"use client";

import { ActionForm, Submit } from "./Form.tsx";
import { adminMoneyAction } from "@/app/actions.ts";

/** A one-click admin action on a payout or refund (retry, mark done, run the queue). */
export default function AdminButton({ op, id = 0, children }: { op: string; id?: number; children: React.ReactNode }) {
  return (
    <ActionForm action={adminMoneyAction} className="inline">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <Submit className="btn">{children}</Submit>
    </ActionForm>
  );
}
