"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function prepareLogin() {
      try {
        const response = await fetch("/api/auth", { cache: "no-store" });
        const data = await response.json() as { mode?: unknown };
        if (!active) return;
        setAvailable(data.mode === "password");
        setMessage(data.mode === "password" ? "" : "Der persönliche Trainerzugang ist noch nicht vollständig konfiguriert.");
      } catch {
        if (active) setMessage("Der Trainerzugang konnte gerade nicht geladen werden. Bitte Seite neu laden.");
      } finally {
        if (active) setReady(true);
      }
    }
    void prepareLogin();
    return () => { active = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: loginName, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return <main className="login-shell login-loading-shell" aria-busy="true"><Image className="login-loading-claim" src="/brand/allez-tsg.png" alt="Allez TSG" width={620} height={138} priority unoptimized /><p>Trainerzugang wird geladen …</p></main>;
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={110} height={110} priority unoptimized />
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p>Mit deinem persönlichen Trainerzugang anmelden.</p>
        <form onSubmit={login}>
          <label htmlFor="trainer-login">Benutzername oder E-Mail</label>
          <input
            id="trainer-login"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            autoFocus
            disabled={!available}
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
          />
          <label htmlFor="trainer-password">Passwort</label>
          <input
            id="trainer-password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            disabled={!available}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" disabled={!loginName || !password || loading || !available}>{loading ? "Wird geprüft …" : "Anmelden"}</button>
        </form>
        {message && <p className="login-error" role="status">{message}</p>}
      </section>
    </main>
  );
}
