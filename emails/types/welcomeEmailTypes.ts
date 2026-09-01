/**
 * Email template configuration and types for Umuhle welcome emails
 */

export type UserRole = 'artist' | 'store_owner' | 'customer';

export interface EmailTemplateVariables {
  logoUrl: string;
  firstName: string;
  dashboardUrl: string;
  websiteUrl: string;
  currentYear: number;
}

export interface WelcomeEmailContent {
  subject: string;
  heading: string;
  greeting: string;
  introduction: string;
  features: string[];
  ctaText: string;
  ctaUrl: string;
  callToAction: string;
  closing: string;
}

export const UMUHLE_BRAND = {
  primaryColor: '#9B7FB8',
  backgroundColor: '#F4EFF8',
  fontFamily: "'DM Sans', Arial, sans-serif",
  tagline: 'Connecting Beauty, Business and Opportunity',
} as const;

export const WELCOME_EMAIL_CONTENT: Record<UserRole, WelcomeEmailContent> = {
  artist: {
    subject: 'Welcome to Umuhle, Your Beauty Business Starts Here',
    heading: 'Your Beauty Business Starts Here',
    greeting: 'Welcome to Umuhle.',
    introduction:
      'Thank you for joining our growing community of beauty professionals. Your account has been created successfully and you are now ready to start building your presence on the platform.',
    features: [
      'Create and manage your professional profile',
      'Showcase your services and pricing',
      'Upload portfolio images of your work',
      'Receive and manage bookings',
      'Connect with new clients looking for beauty services',
    ],
    ctaText: 'Complete My Profile',
    ctaUrl: '{{dashboard_url}}',
    callToAction:
      'To get the most out of your account, we recommend completing your profile as soon as possible. Profiles with complete information and quality portfolio images are more likely to attract customers.\n\nClick the button below to access your dashboard and complete your profile.',
    closing:
      'If you need assistance, our support team is available to help.',
  },
  store_owner: {
    subject: 'Welcome to Umuhle, Start Growing Your Store',
    heading: 'Start Growing Your Store',
    greeting: 'Welcome to Umuhle.',
    introduction:
      'Thank you for registering your store with us. We are excited to help you connect with customers who are looking for beauty products and services.',
    features: [
      'Create and manage your store profile',
      'List and sell beauty products',
      'Manage orders and inventory',
      'Reach new customers across South Africa',
      'Promote your business through advertising opportunities on the platform',
    ],
    ctaText: 'Set Up My Store',
    ctaUrl: '{{dashboard_url}}',
    callToAction:
      'To start selling, please complete your store information and add your first products.\n\nClick the button below to access your dashboard and set up your store.',
    closing:
      'If you have any questions, our support team is ready to assist you.',
  },
  customer: {
    subject: 'Welcome to Umuhle',
    heading: 'Welcome to Umuhle',
    greeting: 'Welcome to Umuhle.',
    introduction:
      'Thank you for creating your account. You are now part of a community that makes it easier to discover beauty professionals, beauty products, and beauty services all in one place.',
    features: [
      'Browse beauty professionals and businesses',
      'Book beauty services',
      'Shop for beauty products',
      'Save your favourite providers and stores',
      'Track your bookings and orders',
    ],
    ctaText: 'Explore Umuhle',
    ctaUrl: '{{website_url}}',
    callToAction:
      'You can start exploring immediately by visiting the platform and discovering the services and products available near you.\n\nClick the button below to get started.',
    closing: 'If you need assistance, our support team is available to help.',
  },
};
