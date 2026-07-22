"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={110} height={110} priority unoptimized />
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p>Bitte Bearbeitungs-PIN eingeben, um die Aufstellung zu öffnen.</p>
        <form onSubmit={login}>
          <label htmlFor="site-pin">PIN</label>
          <input
            id="site-pin"
            type="password"
            inputMode="text"
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={128}
            autoFocus
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <button type="submit" disabled={!pin || loading}>{loading ? "Prüft …" : "Aufstellung öffnen"}</button>
        </form>
        {message && <p className="login-error" role="alert">{message}</p>}
      </section>
    </main>
  );
}
