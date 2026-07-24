"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";

type AuthMode = "pin" | "otp";

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
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
        body: JSON.stringify(mode === "otp" ? (codeRequested ? { email, token } : { email }) : { pin }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
      if (mode === "otp") {
        if (codeRequested) {
          window.location.assign("/");
          return;
        }
        setCodeRequested(true);
        setMessage("Anmeldecode gesendet. Bitte den Code aus der E-Mail eingeben.");
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
  const value = isOtp ? (codeRequested ? token : email) : pin;

  return (
    <main className="login-shell">
      <section className="login-card">
        <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={110} height={110} priority unoptimized />
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p>{isOtp ? "Mit deiner freigegebenen Trainer-E-Mail anmelden. Wir senden dir einen einmaligen Anmeldecode." : "Bitte Bearbeitungs-PIN eingeben, um die Aufstellung zu öffnen."}</p>
        <form onSubmit={login}>
          <label htmlFor="site-login">{isOtp ? (codeRequested ? "Anmeldecode" : "Trainer-E-Mail") : "PIN"}</label>
          <input
            id="site-login"
            type={isOtp && !codeRequested ? "email" : "text"}
            inputMode={isOtp ? (codeRequested ? "numeric" : "email") : "text"}
            autoComplete={isOtp ? (codeRequested ? "one-time-code" : "email") : "current-password"}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={isOtp ? (codeRequested ? 12 : 254) : 128}
            autoFocus
            disabled={!mode}
            value={value}
            onChange={(event) => isOtp
              ? (codeRequested ? setToken(event.target.value.replace(/\s/g, "")) : setEmail(event.target.value))
              : setPin(event.target.value)}
          />
          <button type="submit" disabled={!value || loading || !mode}>{loading ? "Wird geprüft …" : isOtp ? (codeRequested ? "Code bestätigen" : "Anmeldecode senden") : "Aufstellung öffnen"}</button>
        </form>
        {message && <p className="login-error" role="status">{message}</p>}
      </section>
    </main>
  );
}
