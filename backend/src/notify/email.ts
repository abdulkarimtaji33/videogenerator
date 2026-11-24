// Email notification when a video is waiting for approval. Silently skipped (and logged) when SMTP is not
// configured, so the pipeline never fails because of email.
import nodemailer, { Transporter } from "nodemailer";
import { loadConfig } from "../config";
import { logger } from "../log";
import type { ShortPlan } from "../shorts/plan";

export function emailConfigured(): boolean {
  const c = loadConfig();
  return !!(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASSWORD && c.NOTIFY_TO);
}

export interface MailMessage {
  subject: string;
  text: string;
}

export async function sendEmail(msg: MailMessage, transport?: Transporter): Promise<boolean> {
  const c = loadConfig();
  if (!transport && !emailConfigured()) {
    logger.info("email not configured; skipped", { subject: msg.subject });
    return false;
  }
  const t = transport ?? nodemailer.createTransport({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_PORT === 465, auth: { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } });
  await t.sendMail({ from: c.SMTP_USER || "videogenerator@localhost", to: c.NOTIFY_TO || "me@localhost", subject: msg.subject, text: msg.text });
  return true;
}

export const reviewUrl = (projectId: number) => `${process.env.PUBLIC_UI_URL || "http://localhost:4500"}/review?project=${projectId}`;

export async function notifyAwaitingApproval(projectId: number, plan: ShortPlan, transport?: Transporter): Promise<boolean> {
  try {
    return await sendEmail(
      { subject: `Ready for approval: ${plan.title}`, text: `A new ${plan.targetSeconds}s Short passed its quality checks.\n\nTitle: ${plan.title}\nHook (${plan.hook.type}): ${plan.hook.line}\n\nReview and approve or reject it here:\n${reviewUrl(projectId)}\n` },
      transport
    );
  } catch (err) {
    logger.warn("approval email failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
