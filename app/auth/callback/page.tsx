"use client";

import { useEffect, useState } from "react";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "Anmeldung wird bestätigt …";
    return new URLSearchParams(window.location.hash.slice(1)).get("access_token")
      ? "Anmeldung wird bestätigt …"
      : "Der Anmeldelink ist ungültig oder bereits abgelaufen. Bitte erneut anfordern.";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    if (!accessToken) return;
    fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Anmeldung fehlgeschlagen.");
        window.location.replace("/");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen."));
  }, []);

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="section-index">GESCHÜTZTER BEREICH</p>
        <h1>Kader D1</h1>
        <p className="login-error" role="status">{message}</p>
      </section>
    </main>
  );
}
