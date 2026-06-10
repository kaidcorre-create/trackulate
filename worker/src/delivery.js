/**
 * Trackulate — Delivery emails via Resend
 * Sends licence keys to buyers after purchase
 */

export async function sendDeliveryEmail(env, email, name, licenceKey) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set — skipping delivery email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const html = buildDeliveryEmail(name || "there", licenceKey);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": "Bearer " + env.RESEND_API_KEY,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    "Trackulate <noreply@trackulate.co.uk>",
        to:      [email],
        subject: "Your Trackulate Pro licence key",
        html:    html,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Resend error:", JSON.stringify(data));
      return { success: false, error: data.message || "Email send failed" };
    }
    return { success: true, id: data.id };
  } catch (e) {
    console.error("Delivery email exception:", e.message);
    return { success: false, error: e.message };
  }
}

function buildDeliveryEmail(name, licenceKey) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0ECF5;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:32px auto;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(46,21,64,0.12);">

  <!-- Header -->
  <div style="background:#2E1540;padding:28px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:36px;vertical-align:middle;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="36" height="36">
            <rect width="500" height="500" rx="80" fill="#F8F5FA"/>
            <rect x="78" y="108" width="344" height="72" rx="5" fill="#D9B8F0"/>
            <rect x="212" y="180" width="76" height="222" rx="4" fill="#2E1540"/>
          </svg>
        </td>
        <td style="padding-left:14px;vertical-align:middle;">
          <div style="color:#B892D4;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:3px;">Trackulate</div>
          <div style="color:#F8F5FA;font-size:20px;font-weight:bold;letter-spacing:-0.3px;">Your Pro key is ready</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Body -->
  <div style="background:#F8F5FA;padding:28px 32px;">
    <p style="color:#2E1540;font-size:15px;margin:0 0 16px;">Hi ${name},</p>
    <p style="color:#2E1540;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Thanks for upgrading to <strong>Trackulate Pro</strong>. Your licence key is below.
      Keep it somewhere safe — you'll need it to activate Pro features on any sheet.
    </p>

    <!-- Key box -->
    <div style="background:#2E1540;border-radius:8px;padding:20px 24px;margin-bottom:28px;text-align:center;">
      <div style="color:#B892D4;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Your Licence Key</div>
      <div style="color:#F8F5FA;font-family:'Courier New',monospace;font-size:22px;font-weight:bold;letter-spacing:3px;">${licenceKey}</div>
    </div>

    <!-- Steps -->
    <p style="color:#2E1540;font-size:13px;font-weight:bold;margin:0 0 14px;letter-spacing:-0.1px;">How to activate in 3 steps:</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="width:28px;vertical-align:top;padding:8px 10px 8px 0;">
          <div style="width:24px;height:24px;border-radius:50%;background:#E8D4F8;color:#B892D4;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">1</div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #EDE5F8;color:#2E1540;font-size:13px;line-height:1.5;">
          Open your Trackulate sheet and click <strong>✦ Trackulate</strong> in the menu bar
        </td>
      </tr>
      <tr>
        <td style="width:28px;vertical-align:top;padding:8px 10px 8px 0;">
          <div style="width:24px;height:24px;border-radius:50%;background:#E8D4F8;color:#B892D4;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">2</div>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #EDE5F8;color:#2E1540;font-size:13px;line-height:1.5;">
          Choose <strong>Open Control Centre</strong>, then click <strong>Unlock Pro Features</strong>
        </td>
      </tr>
      <tr>
        <td style="width:28px;vertical-align:top;padding:8px 10px 8px 0;">
          <div style="width:24px;height:24px;border-radius:50%;background:#E8D4F8;color:#B892D4;font-size:12px;font-weight:bold;text-align:center;line-height:24px;">3</div>
        </td>
        <td style="padding:8px 0;color:#2E1540;font-size:13px;line-height:1.5;">
          Click <strong>"I already have a key"</strong>, paste your key above, and hit <strong>Activate</strong>
        </td>
      </tr>
    </table>

    <div style="background:#E8D4F8;border-radius:7px;padding:12px 16px;margin-bottom:24px;">
      <p style="color:#2E1540;font-size:12px;margin:0;line-height:1.6;">
        <strong>Having trouble?</strong> Visit
        <a href="https://trackulate.co.uk/activate" style="color:#B892D4;">trackulate.co.uk/activate</a>
        or email <a href="mailto:support@trackulate.co.uk" style="color:#B892D4;">support@trackulate.co.uk</a>
      </p>
    </div>

    <hr style="border:none;border-top:1px solid #EDE5F8;margin:20px 0;">
    <p style="color:#B892D4;font-size:10px;margin:0;line-height:1.8;">
      Single user licence &middot; Do not share or redistribute &middot;
      <a href="https://trackulate.co.uk" style="color:#B892D4;">trackulate.co.uk</a>
    </p>
  </div>

</div>
</body>
</html>`;
}
