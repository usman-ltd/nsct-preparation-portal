export function verificationEmail(code) {
  if (!/^\d{6}$/.test(code) || typeof code !== 'string') throw new TypeError('Expected a six-digit verification code');
  const subject = 'Your NSCT registration code';
  const text = [
    'NSCT Preparation Portal',
    'Riphah International University · Sahiwal Campus',
    '',
    'Enter this code on the registration page to verify your email address.',
    '',
    code,
    '',
    'This code expires in 10 minutes.',
    'If you did not request this code, you can ignore this email.'
  ].join('\n');
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px 12px;background:#f2f5f6;color:#173548;font-family:Arial,sans-serif">
  <div style="max-width:480px;margin:auto;background:white;border:1px solid #d6dfe3">
    <div style="padding:20px 24px;background:#103246;color:white;border-bottom:3px solid #d5a75d">
      <strong style="font-size:19px">NSCT Preparation Portal</strong>
      <div style="margin-top:5px;font-size:14px">Riphah International University · Sahiwal Campus</div>
    </div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:24px">Verify your email address</h1>
      <p style="margin:0;line-height:1.5">Enter this six-digit code on the registration page.</p>
      <p dir="ltr" style="margin:20px 0 12px;padding:16px 6px;background:#eff4f5;text-align:center;font:bold 40px/1.2 monospace;letter-spacing:4px;color:#103246">${code}</p>
      <p style="margin:0;font-size:14px">This code expires in <strong>10 minutes</strong>.</p>
      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #d6dfe3;font-size:14px;line-height:1.5;color:#526675">If you did not request this code, you can ignore this email.</p>
    </div>
  </div>
</body></html>`;
  return {subject, text, html};
}
