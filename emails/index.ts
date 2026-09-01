/**
 * Welcome email index - exports all email functionality
 */

export {
  generateWelcomeEmail,
  getEmailSubject,
} from './components/WelcomeEmailTemplate';

export { sendWelcomeEmail } from './services/emailService';

export type { UserRole, EmailTemplateVariables, WelcomeEmailContent } from './types/welcomeEmailTypes';

export { UMUHLE_BRAND, WELCOME_EMAIL_CONTENT } from './types/welcomeEmailTypes';
