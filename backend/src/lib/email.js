import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
const getTransport = () => {
    const hasPlaceholder = env.SMTP_USER.includes('your-email') ||
        env.SMTP_PASS.includes('your-16-character') ||
        env.SMTP_FROM.includes('your-email');
    if (!env.SMTP_USER || !env.SMTP_PASS || hasPlaceholder) {
        throw new AppError(503, 'EMAIL_SERVICE_NOT_CONFIGURED', 'Email verification is not configured. Add SMTP credentials to backend/.env.');
    }
    return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
};
export const sendRegistrationOtp = async (email, name, code) => {
    await getTransport().sendMail({
        from: env.SMTP_FROM,
        to: email,
        subject: 'Verify your Reproutes account',
        text: `Hello ${name}, your Reproutes verification code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
        html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;background:#07111f;color:#e2e8f0;border-radius:18px">
        <h1 style="margin:0;color:#22d3ee;font-size:24px">Reproutes</h1>
        <p style="margin-top:24px">Hello ${name},</p>
        <p>Use this one-time code to verify your new Agent account:</p>
        <div style="margin:24px 0;padding:18px;text-align:center;font-size:32px;letter-spacing:10px;font-weight:800;background:#0f2038;border:1px solid #155e75;border-radius:14px;color:#67e8f9">${code}</div>
        <p style="font-size:13px;color:#94a3b8">This code expires in ${env.OTP_TTL_MINUTES} minutes. If you did not request this account, ignore this email.</p>
      </div>
    `,
    });
};
export const sendPasswordReset = async (email, name, resetUrl) => {
    await getTransport().sendMail({
        from: env.SMTP_FROM,
        to: email,
        subject: 'Reset your Reproutes password',
        text: `Hello ${name}, reset your Reproutes password using this one-time link: ${resetUrl}\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;background:#07111f;color:#e2e8f0;border-radius:18px">
          <h1 style="margin:0;color:#22d3ee;font-size:24px">Reproutes</h1><p style="margin-top:24px">Hello ${name},</p>
          <p>Use this one-time link to reset your password. It expires in 15 minutes.</p>
          <p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#06b6d4;color:#082f49;font-weight:700;text-decoration:none">Reset password</a></p>
          <p style="font-size:13px;color:#94a3b8">If you did not request a password reset, you can safely ignore this email.</p></div>`,
    });
};
