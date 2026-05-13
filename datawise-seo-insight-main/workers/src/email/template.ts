// Shared DataWise email template.
// Brand: Plus Jakarta Sans / Caveat, #1F7A43 forest green, mint #E9F3EC, ink #0E1414.
// Layout: 600px centered, masthead + hairline + content + CTA + hairline + footer.
// Supports dark-mode clients (Apple Mail, iOS, Outlook.com) and Gmail forced-dark via [data-ogsc].

export interface EmailButton {
  label: string;
  url: string;
  variant?: 'primary' | 'ghost';
}

export interface EmailOptions {
  preheader: string;
  eyebrow?: string;         // e.g. "Founder note · 4 min read"
  issueLabel?: string;      // masthead right text, e.g. "Welcome · Tue"
  headline: string;         // H1, may contain <br /> and <span class="dw-accent"> for green accent
  byline?: string;          // small subtitle under headline
  body: string;             // safe HTML body
  callout?: {               // optional mint-tint card
    eyebrow?: string;
    title: string;
    body: string;
    linkLabel?: string;
    linkUrl?: string;
  };
  postscript?: string;      // handwritten flourish line (plain text)
  buttons?: EmailButton[];
  trustLine?: string;       // safe HTML trust line under the CTA
  footerNote?: string;      // overrides the default "You're getting this..." line
  unsubscribeUrl?: string;
}

const MASTHEAD_LOGO = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:10px; line-height:0;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="DataWise">
        <rect x="3" y="13" width="4" height="8" rx="1" fill="#1F7A43"></rect>
        <rect x="10" y="8" width="4" height="13" rx="1" fill="#1F7A43"></rect>
        <rect x="17" y="3" width="4" height="18" rx="1" fill="#1F7A43"></rect>
      </svg>
    </td>
    <td valign="middle" class="dw-fg dw-logo-wordmark" style="font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:18px; font-weight:800; color:#0E1414; letter-spacing:-0.4px; line-height:22px;">
      DataWise
    </td>
  </tr></table>
`;

function renderButtons(buttons: EmailButton[]): string {
  if (!buttons.length) return '';
  const cells = buttons.map((btn, i) => {
    const isPrimary = (btn.variant ?? (i === 0 ? 'primary' : 'ghost')) === 'primary';
    const gap = i > 0 ? `<td class="dw-btn-gap" style="width:10px; line-height:0; font-size:0;">&nbsp;</td>` : '';
    if (isPrimary) {
      return `${gap}<td align="left" class="dw-btn dw-btn-primary" style="border-radius:9999px;">
        <a href="${btn.url}" style="display:inline-block; background:#1F7A43; color:#FFFFFF; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:15px; font-weight:700; line-height:48px; text-decoration:none; border-radius:9999px; padding:0 26px; letter-spacing:-0.1px;">${btn.label}</a>
      </td>`;
    }
    return `${gap}<td align="left" class="dw-btn dw-btn-ghost" style="border-radius:9999px;">
      <a href="${btn.url}" style="display:inline-block; background:#FFFFFF; color:#0E1414; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:15px; font-weight:700; line-height:46px; text-decoration:none; border-radius:9999px; padding:0 24px; border:1px solid #D2D9D6; letter-spacing:-0.1px;">${btn.label}</a>
    </td>`;
  }).join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="dw-btn-row">
      <tr>${cells}</tr>
    </table>
  `;
}

function renderPostscript(text: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left">
      <tr>
        <td valign="middle" class="mso-script dw-script" style="font-family:'Caveat','Segoe Script','Bradley Hand','Comic Sans MS',cursive; font-size:26px; line-height:1.1; color:#1F7A43; font-weight:500; padding-right:8px;">
          ${text}
        </td>
        <td valign="middle" style="line-height:0;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 44" width="80" height="26" aria-hidden="true">
            <path d="M2 30 C 30 20, 60 14, 110 22" fill="none" stroke="#1F7A43" stroke-width="2" stroke-linecap="round"></path>
            <path d="M100 14 L 114 22 L 104 31" fill="none" stroke="#1F7A43" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:14px; line-height:14px; font-size:0;">&nbsp;</td></tr></table>
  `;
}

function renderCallout(c: NonNullable<EmailOptions['callout']>): string {
  const link = c.linkLabel && c.linkUrl
    ? `<div style="padding-top:14px;">
         <a class="dw-link" href="${c.linkUrl}" style="color:#1F7A43; font-weight:700; font-size:14px; text-decoration:none; border-bottom:1px solid #1F7A43; padding-bottom:1px;">${c.linkLabel} →</a>
       </div>`
    : '';
  const eyebrow = c.eyebrow
    ? `<div class="dw-fg-muted" style="font-size:11px; font-weight:700; color:#166337; letter-spacing:1.4px; text-transform:uppercase;">${c.eyebrow}</div>`
    : '';
  return `
    <tr>
      <td class="dw-px" style="padding:20px 40px 8px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dw-surface-alt" style="background:#E9F3EC; border-radius:14px;">
          <tr>
            <td style="padding:24px 24px 22px 24px; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif;">
              ${eyebrow}
              <div class="dw-fg" style="font-size:18px; font-weight:700; color:#0E1414; line-height:1.35; padding-top:${c.eyebrow ? '8px' : '0'}; letter-spacing:-0.2px;">${c.title}</div>
              <div class="dw-fg-muted" style="font-size:15px; line-height:1.6; color:#2C3837; padding-top:8px;">${c.body}</div>
              ${link}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

export function renderEmail(opts: EmailOptions): string {
  const {
    preheader,
    eyebrow,
    issueLabel = '',
    headline,
    byline,
    body,
    callout,
    postscript,
    buttons = [],
    trustLine,
    footerNote,
    unsubscribeUrl,
  } = opts;

  const eyebrowHtml = eyebrow ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="dw-hairline" style="border:1px solid #E4E8E6; border-radius:9999px; padding:6px 12px; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:12px; font-weight:600; color:#2C3837; background:#FFFFFF;">
          <span style="color:#1F7A43; font-size:14px; line-height:12px; vertical-align:middle;">●</span>
          <span class="dw-fg" style="vertical-align:middle; margin-left:6px; color:#0E1414 !important; font-weight:700;">${eyebrow}</span>
        </td>
      </tr>
    </table>
  ` : '';

  const bylineHtml = byline ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="dw-fg-subtle" style="padding:18px 0 0 0; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:13px; font-weight:500; color:#7E8C8A; letter-spacing:0.2px;">
          ${byline}
        </td>
      </tr>
    </table>
  ` : '';

  const footerDefault = `You're getting this from DataWise &middot; AI Ranking. We only send emails tied to your account or things we think you'll actually want.`;
  const unsubLink = unsubscribeUrl ? `
    <span style="opacity:0.4; padding:0 6px;">·</span>
    <a class="dw-link" href="${unsubscribeUrl}" style="color:#5A6968; text-decoration:underline;">Unsubscribe</a>
  ` : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml></noscript>
  <style>
    * { font-family: 'Segoe UI', Arial, sans-serif !important; }
    table { border-collapse: collapse; }
    .mso-script { font-family: 'Segoe Script', 'Comic Sans MS', cursive !important; }
  </style>
  <![endif]-->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Caveat:wght@500;600&display=swap" rel="stylesheet" />
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; border-collapse: collapse; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
    a { text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background: #FBFCFB; }
    a.dw-link { color: #1F7A43; text-decoration: underline; text-underline-offset: 2px; }
    a.dw-link:hover { color: #166337; }
    .dw-btn-primary a:hover { background: #166337 !important; }
    .dw-btn-ghost a:hover { background: #E9F3EC !important; }
    @media only screen and (max-width: 620px) {
      .dw-container { width: 100% !important; max-width: 100% !important; }
      .dw-px { padding-left: 24px !important; padding-right: 24px !important; }
      .dw-h1 { font-size: 32px !important; line-height: 1.1 !important; }
      .dw-lead { font-size: 16px !important; }
      .dw-btn a { display: block !important; width: 100% !important; box-sizing: border-box !important; }
      .dw-btn-row td { display: block !important; width: 100% !important; }
      .dw-btn-row td.dw-btn-gap { height: 10px !important; width: 100% !important; }
      .dw-trust-line { font-size: 12px !important; }
    }
    @media (prefers-color-scheme: dark) {
      body, .dw-bg { background: #0B1110 !important; }
      .dw-surface { background: #12191A !important; }
      .dw-surface-alt { background: #0F2419 !important; }
      .dw-fg { color: #EEF1EE !important; }
      .dw-fg-muted { color: #AAB5B3 !important; }
      .dw-fg-subtle { color: #7E8C8A !important; }
      .dw-hairline { border-color: #223029 !important; }
      .dw-accent { color: #58B27A !important; }
      .dw-btn-ghost a { background: #12191A !important; color: #EEF1EE !important; border-color: #2C3837 !important; }
      .dw-btn-ghost a:hover { background: #0F2419 !important; }
      .dw-script { color: #58B27A !important; }
      .dw-footer-bg { background: #0B1110 !important; }
      .dw-logo-wordmark { color: #EEF1EE !important; }
    }
    [data-ogsc] body, [data-ogsc] .dw-bg { background: #0B1110 !important; }
    [data-ogsc] .dw-surface { background: #12191A !important; }
    [data-ogsc] .dw-surface-alt { background: #0F2419 !important; }
    [data-ogsc] .dw-fg { color: #EEF1EE !important; }
    [data-ogsc] .dw-fg-muted { color: #AAB5B3 !important; }
    [data-ogsc] .dw-fg-subtle { color: #7E8C8A !important; }
    [data-ogsc] .dw-hairline { border-color: #223029 !important; }
    [data-ogsc] .dw-accent { color: #58B27A !important; }
    [data-ogsc] .dw-btn-ghost a { background: #12191A !important; color: #EEF1EE !important; border-color: #2C3837 !important; }
    [data-ogsc] .dw-script { color: #58B27A !important; }
    [data-ogsc] .dw-logo-wordmark { color: #EEF1EE !important; }
    .dw-script { font-family: 'Caveat', 'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive !important; }
  </style>
</head>
<body style="margin:0; padding:0; background:#FBFCFB; font-family:'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#0E1414;">
  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0; mso-hide:all;">
    ${preheader} &nbsp;‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌ ‌
  </div>
  <table role="presentation" class="dw-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBFCFB;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" class="dw-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

          <tr>
            <td class="dw-px" style="padding:28px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle" style="font-size:0; line-height:0;">${MASTHEAD_LOGO}</td>
                  <td align="right" valign="middle" class="dw-fg-muted" style="font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:11px; font-weight:600; color:#5A6968; letter-spacing:1.2px; text-transform:uppercase;">${issueLabel}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="dw-px" style="padding:16px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td class="dw-hairline" style="border-top:1px solid #E4E8E6; line-height:0; font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="dw-px dw-surface" style="padding:36px 40px 8px 40px; background:#FBFCFB;">
              ${eyebrowHtml}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="dw-fg dw-h1" style="padding:${eyebrow ? '22px' : '0'} 0 0 0; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:40px; font-weight:800; line-height:1.08; letter-spacing:-0.8px; color:#0E1414;">
                    ${headline}
                  </td>
                </tr>
              </table>
              ${bylineHtml}
            </td>
          </tr>

          <tr>
            <td class="dw-px dw-surface" style="padding:24px 40px 8px 40px; background:#FBFCFB;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="dw-fg dw-lead" style="font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:17px; line-height:1.6; color:#2C3837;">
                    ${body}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${callout ? renderCallout(callout) : ''}

          ${(postscript || buttons.length || trustLine) ? `
          <tr>
            <td class="dw-px dw-surface" style="padding:28px 40px 8px 40px; background:#FBFCFB;">
              ${postscript ? renderPostscript(postscript) : ''}
              ${renderButtons(buttons)}
              ${trustLine ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="dw-fg-muted dw-trust-line" style="padding:18px 0 0 0; font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:13px; font-weight:500; color:#5A6968; line-height:1.6;">${trustLine}</td>
                </tr>
              </table>
              ` : ''}
            </td>
          </tr>
          ` : ''}

          <tr>
            <td class="dw-px dw-surface" style="padding:32px 40px 0 40px; background:#FBFCFB;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td class="dw-hairline" style="border-top:1px solid #E4E8E6; line-height:0; font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="dw-px dw-surface dw-footer-bg" style="padding:22px 40px 40px 40px; background:#FBFCFB;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="top" class="dw-fg-subtle" style="font-family:'Plus Jakarta Sans', -apple-system, 'Segoe UI', Arial, sans-serif; font-size:12px; line-height:1.6; color:#7E8C8A;">
                    ${footerNote ?? footerDefault}
                    <br /><br />
                    DataWise &middot; AI Ranking SpA<br />
                    <a class="dw-link" href="https://www.skool.com/ai-ranking/" style="color:#5A6968; text-decoration:underline;">Visit the community</a>
                    ${unsubLink}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
