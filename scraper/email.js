// Helper único de envio de email via Resend, usado pelos alertas de preço e de cupom.
// Retorna { ok } sem lançar quando não há config, para o chamador decidir o que fazer.

export function emailConfigurado() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL);
}

// Envia um email. Lança se a API do Resend recusar (para o chamador não marcar como
// enviado e tentar de novo na próxima rodada).
export async function enviarEmailResend({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const destinatario = process.env.ALERT_EMAIL;
  if (!apiKey || !destinatario) throw new Error("RESEND_API_KEY/ALERT_EMAIL não configurados");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Rastreador de Preços <onboarding@resend.dev>",
      to: [destinatario],
      subject,
      html,
    }),
  });
  if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}: ${await resp.text()}`);
}
