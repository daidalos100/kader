"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

type AuthMode = "pin" | "otp";

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setMode(data.mode === "otp" ? "otp" : "pin"))
      .catch(() => setMode("pin"));
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
        body: JSON.stringify(mode === "otp" ? { email } : { pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
      if (mode === "otp") {
        setMessage("Anmeldelink gesendet. Bitte E-Mail-Postfach öffnen und den Link bestätigen.");
        return;
      }
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  const isOtp = mode === "otp";
  const value = isOtp ? email : pin;

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={110} height={110} priority unoptimized />
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p>{isOtp ? "Mit deiner freigegebenen Trainer-E-Mail anmelden. Wir senden dir einen einmaligen Anmeldelink." : "Bitte Bearbeitungs-PIN eingeben, um die Aufstellung zu öffnen."}</p>
        <form onSubmit={login}>
          <label htmlFor="site-login">{isOtp ? "Trainer-E-Mail" : "PIN"}</label>
          <input
            id="site-login"
            type={isOtp ? "email" : "password"}
            inputMode={isOtp ? "email" : "text"}
            autoComplete={isOtp ? "email" : "current-password"}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={isOtp ? 254 : 128}
            autoFocus
            disabled={!mode}
            value={value}
            onChange={(event) => isOtp ? setEmail(event.target.value) : setPin(event.target.value)}
          />
          <button type="submit" disabled={!value || loading || !mode}>{loading ? "Wird gesendet …" : isOtp ? "Anmeldelink senden" : "Aufstellung öffnen"}</button>
        </form>
        {message && <p className="login-error" role="status">{message}</p>}
      </section>
    </main>
  );
}
