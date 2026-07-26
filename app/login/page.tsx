"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

type AuthMode = "pin" | "password";

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepareLogin() {
      try {
        const response = await fetch("/api/auth", { cache: "no-store" });
        const data = await response.json() as { mode?: unknown };
        if (active) setMode(data.mode === "password" ? "password" : "pin");
      } catch {
        if (active) setMode("pin");
      }
    }
    void prepareLogin();
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "password" ? { login: loginName, password } : { pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
      setPassword("");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  const passwordLogin = mode === "password";

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={110} height={110} priority unoptimized />
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p>{passwordLogin ? "Mit deinem persönlichen Trainerzugang anmelden." : "Bitte Bearbeitungs-PIN eingeben, um die Aufstellung zu öffnen."}</p>
        <form onSubmit={login}>
          {passwordLogin ? (
            <>
              <label htmlFor="trainer-login">Benutzername oder E-Mail</label>
              <input
                id="trainer-login"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                autoFocus
                disabled={!mode}
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
              />
              <label htmlFor="trainer-password">Passwort</label>
              <input
                id="trainer-password"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                disabled={!mode}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="trainer-pin">PIN</label>
              <input
                id="trainer-pin"
                type="password"
                inputMode="text"
                autoComplete="current-password"
                maxLength={128}
                autoFocus
                disabled={!mode}
                value={pin}
                onChange={(event) => setPin(event.target.value)}
              />
            </>
          )}
          <button type="submit" disabled={(!passwordLogin ? !pin : !loginName || !password) || loading || !mode}>{loading ? "Wird geprüft …" : passwordLogin ? "Anmelden" : "Aufstellung öffnen"}</button>
        </form>
        {message && <p className="login-error" role="status">{message}</p>}
      </section>
    </main>
  );
}
