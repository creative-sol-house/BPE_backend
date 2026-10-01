import nodemailer, { Transporter } from 'nodemailer';

let cachedTransporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (cachedTransporter) {
    console.log('📮 [getTransporter] CACHED');
    return cachedTransporter;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  console.log('📮 [getTransporter] user:', JSON.stringify(user));
  console.log('📮 [getTransporter] pass length:', pass?.length);

  if (!user || !pass) {
    throw new Error('SMTP credentials missing');
  }

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user, pass },
  });

  console.log('📮 [getTransporter] CREATED');
  return cachedTransporter;
}

export function getEmailFrom(): string {
  return process.env.EMAIL_FROM || 'CS_ERP <noreply@cserp.com>';
}