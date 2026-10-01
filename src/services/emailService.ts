// services/emailService.ts
import { getTransporter, getEmailFrom } from '../config/email';

// ─── Shared Layout Wrapper ────────────────────────────────────────────────
interface LayoutOptions {
  /** Small label shown above the title (e.g. "ACCOUNT") */
  tag?: string;
  /** Main heading */
  title: string;
  /** Accent colour for the header bar (hex) */
  accent?: string;
  /** Main HTML content */
  body: string;
  /** Optional call-to-action button */
  cta?: { label: string; url?: string };
  /** Optional footer note shown below content */
  footerNote?: string;
}

function emailLayout({
  tag = 'CS_ERP',
  title,
  accent = '#2563eb',
  body,
  cta,
  footerNote,
}: LayoutOptions): string {
  const ctaHtml = cta
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 28px 0 8px;">
        <tr>
          <td align="center" bgcolor="${accent}" style="border-radius: 8px;">
            ${
              cta.url
                ? `<a href="${cta.url}" target="_blank" style="display:inline-block; padding:14px 32px; font-family: Arial, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:8px; background:${accent};">${cta.label}</a>`
                : `<span style="display:inline-block; padding:14px 32px; font-family: Arial, sans-serif; font-size:15px; font-weight:bold; color:#ffffff; border-radius:8px; background:${accent};">${cta.label}</span>`
            }
          </td>
        </tr>
      </table>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">
    ${title} — CS_ERP
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; background:#ffffff; border-radius: 16px; overflow:hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.06);">

          <!-- Header bar -->
          <tr>
            <td style="background: linear-gradient(135deg, ${accent} 0%, #1e40af 100%); padding: 28px 32px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family: Arial, sans-serif; font-size: 13px; letter-spacing: 2px; font-weight: bold; color: rgba(255,255,255,0.85); text-transform: uppercase;">
                    ${tag}
                  </td>
                  <td align="right" style="font-size: 22px;">⚡</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px 32px 40px; color:#1f2937; font-size: 15px; line-height: 1.65;">
              <h1 style="margin:0 0 20px 0; font-size: 24px; line-height: 1.3; color:#111827; font-weight: 700;">
                ${title}
              </h1>
              ${body}
              ${ctaHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px 32px 40px; color:#6b7280; font-size: 12px; line-height: 1.6;">
              ${footerNote ? `<p style="margin:0 0 12px 0;">${footerNote}</p>` : ''}
              <p style="margin:0 0 4px 0;"><strong style="color:#374151;">CS_ERP Team</strong></p>
              <p style="margin:0;">This is an automated message — please do not reply.</p>
              <p style="margin:16px 0 0 0; color:#9ca3af;">
                © ${new Date().getFullYear()} CS_ERP · All rights reserved
              </p>
            </td>
          </tr>
        </table>

        <!-- Sub-footer under card -->
        <p style="margin: 24px 0 0 0; font-size: 11px; color:#9ca3af; font-family: Arial, sans-serif;">
          You received this email because an account action was performed on CS_ERP.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// ─── OTP Email ────────────────────────────────────────────────────────────
export async function sendOTPEmail(email: string, otp: string, name: string) {
  console.log('📧 [sendOTPEmail] START for', email);

  const body = `
    <p style="margin:0 0 16px 0;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 24px 0;">
      Thanks for signing up with <strong>CS_ERP</strong>. To complete your registration, please use the verification code below:
    </p>

    <!-- OTP Card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0;">
      <tr>
        <td align="center" style="background:#f9fafb; border: 2px dashed #d1d5db; border-radius: 12px; padding: 28px 16px;">
          <div style="font-family: 'Courier New', Courier, monospace; font-size: 40px; font-weight: 700; letter-spacing: 12px; color:#111827; margin-left: 12px;">
            ${otp}
          </div>
          <div style="margin-top: 12px; font-size: 12px; color:#6b7280; text-transform: uppercase; letter-spacing: 1px;">
            Verification Code
          </div>
        </td>
      </tr>
    </table>

    <!-- Info row -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eff6ff; border-left: 4px solid #2563eb; border-radius: 8px; margin: 0 0 20px 0;">
      <tr>
        <td style="padding: 14px 18px; font-size: 13px; color:#1e40af;">
          ⏱️ This code expires in <strong>10 minutes</strong>.
        </td>
      </tr>
    </table>

    <p style="margin:0; font-size: 13px; color:#6b7280;">
      If you didn't create an account with CS_ERP, you can safely ignore this email.
    </p>
  `;

  const html = emailLayout({
    tag: 'Email Verification',
    title: 'Verify Your Email',
    accent: '#2563eb',
    body,
    footerNote: 'For your security, never share this code with anyone.',
  });
  console.log('📧 [sendOTPEmail] about to sendMail');

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: '🔐 Verify Your Email — CS_ERP',
    html,
    // Plain-text fallback for clients that don't render HTML
    text: `Hi ${name},\n\nYour CS_ERP verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\n— CS_ERP Team`,
  });
    console.log('📧 [sendOTPEmail] sendMail OK');

}

// ─── Approval Email ───────────────────────────────────────────────────────
export async function sendApprovalEmail(
  email: string,
  name: string,
  department: string,
  role: string
) {
  const body = `
    <p style="margin:0 0 16px 0;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 24px 0;">
      Great news — your CS_ERP account has been <strong style="color:#16a34a;">approved</strong> by the administrator. Welcome aboard! 🎉
    </p>

    <!-- Credentials card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0; background:#f0fdf4; border-radius: 12px; border: 1px solid #bbf7d0;">
      <tr>
        <td style="padding: 20px 22px;">
          <div style="font-size: 12px; color:#15803d; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 12px;">
            Your Assignment
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151; width: 120px;">👤 Username</td>
              <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151;">🏢 Department</td>
              <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${department}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151;">🎯 Role</td>
              <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${role}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 8px 0;">You can now sign in and start using your account.</p>
  `;

  const html = emailLayout({
    tag: 'Account Approved',
    title: 'Welcome to CS_ERP! 🎉',
    accent: '#16a34a',
    body,
    footerNote: 'If you weren\'t expecting this, please contact your administrator immediately.',
  });

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: '✅ Your CS_ERP Account is Approved',
    html,
    text: `Hi ${name},\n\nYour CS_ERP account has been approved.\n\nDepartment: ${department}\nRole: ${role}\n\nYou can now log in with your email and password.\n\n— CS_ERP Team`,
  });
}

// ─── Blocked Email ────────────────────────────────────────────────────────
export async function sendBlockedEmail(email: string, name: string, reason?: string) {
  const reasonBlock = reason
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0; background:#fef2f2; border-left: 4px solid #dc2626; border-radius: 8px;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="font-size: 12px; color:#b91c1c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 6px;">
              Reason
            </div>
            <div style="font-size: 14px; color:#7f1d1d; line-height: 1.55;">
              ${reason}
            </div>
          </td>
        </tr>
      </table>
    `
    : '';

  const body = `
    <p style="margin:0 0 16px 0;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 20px 0;">
      We regret to inform you that your CS_ERP account has been <strong style="color:#dc2626;">blocked</strong> by an administrator.
    </p>
    ${reasonBlock}
    <p style="margin:0 0 12px 0;">
      While blocked, you will not be able to sign in or access any CS_ERP resources.
    </p>
    <p style="margin:0; font-size: 13px; color:#6b7280;">
      If you believe this was a mistake, please reach out to your administrator to appeal.
    </p>
  `;

  const html = emailLayout({
    tag: 'Account Status',
    title: 'Your Account Has Been Blocked',
    accent: '#dc2626',
    body,
    footerNote: 'This action was taken by an authorised CS_ERP administrator.',
  });

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: '🚫 Your CS_ERP Account Has Been Blocked',
    html,
    text: `Hi ${name},\n\nYour CS_ERP account has been blocked.\n${reason ? `Reason: ${reason}\n` : ''}\nContact your administrator if you believe this is a mistake.\n\n— CS_ERP Team`,
  });
}

// ─── Rejection Email ──────────────────────────────────────────────────────
export async function sendRejectionEmail(email: string, name: string, reason?: string) {
  const reasonBlock = reason
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0; background:#fef2f2; border-left: 4px solid #dc2626; border-radius: 8px;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="font-size: 12px; color:#b91c1c; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 6px;">
              Reason
            </div>
            <div style="font-size: 14px; color:#7f1d1d; line-height: 1.55;">
              ${reason}
            </div>
          </td>
        </tr>
      </table>
    `
    : '';

  const body = `
    <p style="margin:0 0 16px 0;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 20px 0;">
      Thank you for your interest in CS_ERP. After reviewing your registration request, we are unable to approve your account at this time.
    </p>
    ${reasonBlock}
    <p style="margin:0 0 12px 0;">
      You are welcome to re-apply in the future if your circumstances change.
    </p>
    <p style="margin:0; font-size: 13px; color:#6b7280;">
      If you have questions about this decision, please contact your administrator.
    </p>
  `;

  const html = emailLayout({
    tag: 'Registration Update',
    title: 'Registration Request Update',
    accent: '#dc2626',
    body,
    footerNote: 'This decision was made by an authorised CS_ERP administrator.',
  });

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: 'CS_ERP — Registration Request Update',
    html,
    text: `Hi ${name},\n\nWe're unable to approve your CS_ERP registration at this time.\n${reason ? `Reason: ${reason}\n` : ''}\n— CS_ERP Team`,
  });
}

// ─── Password Reset OTP ───────────────────────────────────────────────────
export async function sendPasswordResetOTPEmail(
  email: string,
  otp: string,
  name: string
) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">🔐 Password Reset</h2>
      <p>Hi ${name},</p>
      <p>You requested to reset your CS_ERP password. Use the code below to continue:</p>
      <div style="background: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <h1 style="letter-spacing: 8px; color: #1f2937; margin: 0;">${otp}</h1>
      </div>
      <p>This code will expire in <strong>10 minutes</strong>.</p>
      <p style="color:#dc2626;"><strong>If you didn't request this, ignore this email and consider changing your password immediately.</strong></p>
      <br/>
      <p>Regards,<br/>CS_ERP Team</p>
    </div>
  `;

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: '🔐 Reset Your CS_ERP Password',
    html,
    text: `Hi ${name},\n\nYour CS_ERP password reset code is: ${otp}\n\nIt expires in 10 minutes.\nIf you didn't request this, ignore this email.\n\n— CS_ERP Team`,
  });
}

// ─── Welcome Email (direct user creation) ─────────────────────────────────
export async function sendUserCreatedEmail(
  email: string,
  name: string,
  username: string,
  tempPassword: string,
  role?: string,
  department?: string
): Promise<void> {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

  const body = `
    <p style="margin:0 0 16px 0;">Hi <strong>${name}</strong>,</p>
    <p style="margin:0 0 24px 0;">
      Welcome to <strong>CS_ERP</strong>! An account has been created for you by an administrator. Use the credentials below to sign in:
    </p>

    <!-- Credentials card -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 8px 0 24px 0; background:#f0fdfa; border-radius: 12px; border: 1px solid #99f6e4;">
      <tr>
        <td style="padding: 20px 22px;">
          <div style="font-size: 12px; color:#0f766e; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 12px;">
            Your Credentials
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151; width: 160px;">📧 Email</td>
              <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151;">👤 Username</td>
              <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${username}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color:#374151;">🔑 Temporary password</td>
              <td style="padding: 6px 0; font-size: 15px; color:#111827; font-weight: 700; font-family: 'Courier New', Courier, monospace; letter-spacing: 0.5px;">${tempPassword}</td>
            </tr>
            ${
              role
                ? `<tr>
                    <td style="padding: 6px 0; font-size: 14px; color:#374151;">🎯 Role</td>
                    <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${role}</td>
                  </tr>`
                : ''
            }
            ${
              department
                ? `<tr>
                    <td style="padding: 6px 0; font-size: 14px; color:#374151;">🏢 Department</td>
                    <td style="padding: 6px 0; font-size: 14px; color:#111827; font-weight: 600;">${department}</td>
                  </tr>`
                : ''
            }
          </table>
        </td>
      </tr>
    </table>

    <!-- Security notice -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px; margin: 0 0 20px 0;">
      <tr>
        <td style="padding: 14px 18px; font-size: 13px; color:#92400e;">
          🔒 <strong>For your security</strong>, please change this password immediately after your first login.
        </td>
      </tr>
    </table>

    <p style="margin:0; font-size: 13px; color:#6b7280;">
      If you weren't expecting this account, please contact your administrator right away.
    </p>
  `;

  const html = emailLayout({
    tag: 'Welcome',
    title: 'Your CS_ERP account is ready',
    accent: '#0D9488',
    body,
    cta: { label: 'Sign in to CS_ERP', url: loginUrl },
    footerNote: 'This account was created for you by an authorised CS_ERP administrator.',
  });

  await getTransporter().sendMail({
    from: getEmailFrom(),
    to: email,
    subject: '👋 Your CS_ERP account is ready',
    html,
    text: `Hi ${name},

An account has been created for you on CS_ERP.

Email: ${email}
Username: ${username}
Temporary password: ${tempPassword}
${role ? `Role: ${role}\n` : ''}${department ? `Department: ${department}\n` : ''}
Please sign in and change your password immediately:
${loginUrl}

— CS_ERP Team`,
  });
}