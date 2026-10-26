import { baseEmailLayout } from "../layouts/baseLayout";
import { EmailTemplatePayload } from "../types";
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const adminInvitationEmail = (
  setupUrl: string,
): EmailTemplatePayload => ({
  subject: "Your TalentBoard Admin Portal invitation",
  text: `Set your Admin Portal password: ${setupUrl}\nThis link expires in 24 hours and can be used once. If unexpected, ignore this email.`,
  html: baseEmailLayout({
    appName: "TalentBoard Admin",
    supportEmail: "",
    contentHtml: `<p>You have been invited to TalentBoard Admin Portal.</p><p><a href="${escapeHtml(setupUrl)}">Set your password</a></p><p>This link expires in 24 hours and can be used once. If unexpected, ignore this email.</p>`,
  }),
});
