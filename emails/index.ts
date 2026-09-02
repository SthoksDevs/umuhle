/**
 * Welcome email module — re-exports so `@/emails` stays a valid import
 * path for this feature. The actual implementation (and the email_log
 * write every other transactional email on the platform gets) lives in
 * lib/email.ts's sendWelcomeEmail, not duplicated here — the previous
 * version of this file pointed at './services/emailService' and
 * './components/WelcomeEmailTemplate', neither of which was ever
 * committed, which is what broke the build.
 */

export { sendWelcomeEmail } from '@/lib/email';

export type { UserRole, EmailTemplateVariables, WelcomeEmailContent } from './types/welcomeEmailTypes';

export { UMUHLE_BRAND, WELCOME_EMAIL_CONTENT } from './types/welcomeEmailTypes';
