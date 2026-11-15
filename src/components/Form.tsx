"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/server.ts";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

export function Submit({ children, className = "btn primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

/** A form wired to a server action that shows its error or success message. */
export function ActionForm({
  action,
  children,
  className = "stack",
  onSubmitCapture,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  onSubmitCapture?: React.FormEventHandler<HTMLFormElement>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className} onSubmitCapture={onSubmitCapture}>
      {state?.error && <div className="msg err" role="alert">{state.error}</div>}
      {state?.ok && <div className="msg ok" role="status">{state.ok}</div>}
      {children}
    </form>
  );
}
