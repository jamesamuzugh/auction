"use client";

import Link from "next/link";
import { ActionForm, Submit } from "./Form.tsx";
import { loginAction, registerAction } from "@/app/actions.ts";

export default function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const isLogin = mode === "login";
  return (
    <div className="card pad" style={{ maxWidth: 420, margin: "24px auto" }}>
      <h1>{isLogin ? "Sign in" : "Create your account"}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {isLogin ? "Welcome back." : "You need an account to bid or sell."}
      </p>
      <ActionForm action={isLogin ? loginAction : registerAction}>
        {!isLogin && (
          <label>
            Name
            <input name="name" autoComplete="name" required />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          {!isLogin && <span className="hint">At least 8 characters</span>}
          <input
            name="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            minLength={isLogin ? undefined : 8}
            required
          />
        </label>
        <input type="hidden" name="next" value={next} />
        <Submit>{isLogin ? "Sign in" : "Create account"}</Submit>
        <div className="small muted">
          {isLogin ? (
            <>
              New here? <Link href={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
            </>
          )}
        </div>
      </ActionForm>
    </div>
  );
}
