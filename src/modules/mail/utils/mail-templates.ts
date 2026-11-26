/**
 * The mails JobAura sends. Each has an HTML part and a plain-text part: mail with both, a plain
 * layout, no tracking and no link shorteners is less likely to land in spam.
 */

export type RenderedMail = { subject: string; html: string; text: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(
  title: string,
  paragraphs: string[],
  button: { label: string; url: string },
  footer: string,
): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${escapeHtml(p)}</p>`,
    )
    .join('');
  const url = escapeHtml(button.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#111827">JobAura</p>
<h1 style="margin:0 0 16px;font-size:18px;color:#111827">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${url}</span></p>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(footer)}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

function plain(
  title: string,
  paragraphs: string[],
  url: string,
  footer: string,
): string {
  return [
    'JobAura',
    '',
    title,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    url,
    '',
    footer,
  ].join('\n');
}

export function verifyEmailMail(
  name: string,
  url: string,
  minutes: number,
): RenderedMail {
  const title = 'Confirm your email address';
  const paragraphs = [
    `Hi ${name},`,
    `Please confirm that this is your email address. The link works once and expires in ${Math.round(minutes / 60)} hours.`,
  ];
  const footer =
    'If you did not create a JobAura account or change your email, you can ignore this mail.';
  return {
    subject: 'Confirm your email for JobAura',
    html: layout(title, paragraphs, { label: 'Confirm email', url }, footer),
    text: plain(title, paragraphs, url, footer),
  };
}

export function resetPasswordMail(
  name: string,
  url: string,
  minutes: number,
): RenderedMail {
  const title = 'Reset your password';
  const paragraphs = [
    `Hi ${name},`,
    `Someone asked to reset the password of your JobAura account. The link works once and expires in ${minutes} minutes.`,
    'After the reset, every device signed in to your account is signed out.',
  ];
  const footer =
    'If you did not ask for this, ignore this mail: your password stays the same.';
  return {
    subject: 'Reset your JobAura password',
    html: layout(
      title,
      paragraphs,
      { label: 'Choose a new password', url },
      footer,
    ),
    text: plain(title, paragraphs, url, footer),
  };
}
