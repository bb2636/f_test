#!/usr/bin/env node
/**
 * SMTP Verification Script
 * Usage: node scripts/smtp-verify.js
 * 
 * Environment Variables:
 *   MAIL_PROVIDER     - 'hiworks' (default) or 'gmail'
 *   MAIL_APP_PASSWORD - SMTP password (required)
 *   GMAIL_USER        - Gmail address (required if MAIL_PROVIDER=gmail)
 */

const nodemailer = require('nodemailer');

const SMTP_CONFIGS = {
  hiworks: {
    host: 'smtps.hiworks.com',
    port: 465,
    secure: true,
    user: 'hjlee@floxn.co.kr',
  },
  gmail: {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    user: process.env.GMAIL_USER || '',
  },
};

async function verifySmtp() {
  const provider = (process.env.MAIL_PROVIDER || 'hiworks').toLowerCase();
  const password = process.env.MAIL_APP_PASSWORD;

  if (!password) {
    console.error('ERROR: MAIL_APP_PASSWORD environment variable is not set');
    process.exit(1);
  }

  const config = SMTP_CONFIGS[provider] || SMTP_CONFIGS.hiworks;
  
  if (provider === 'gmail' && process.env.GMAIL_USER) {
    config.user = process.env.GMAIL_USER;
  }

  console.log('========================================');
  console.log('SMTP Verification Test');
  console.log('========================================');
  console.log(`Provider: ${provider}`);
  console.log(`Host: ${config.host}`);
  console.log(`Port: ${config.port}`);
  console.log(`Secure (SSL): ${config.secure}`);
  console.log(`User: ${config.user}`);
  console.log(`Password: ${'*'.repeat(Math.min(password.length, 20))}`);
  console.log('========================================');

  console.log('\nTesting with AUTH LOGIN method...\n');
  
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: password,
    },
    authMethod: 'LOGIN',
    debug: true,
    logger: true,
  });

  console.log('\nVerifying SMTP connection...\n');

  try {
    const result = await transporter.verify();
    console.log('========================================');
    console.log('SUCCESS: SMTP connection verified!');
    console.log('========================================');
    console.log('Result:', result);
    process.exit(0);
  } catch (error) {
    console.error('========================================');
    console.error('FAILED: SMTP verification failed');
    console.error('========================================');
    console.error('Error code:', error.code || 'N/A');
    console.error('Error command:', error.command || 'N/A');
    console.error('Error responseCode:', error.responseCode || 'N/A');
    console.error('Error response:', error.response || 'N/A');
    console.error('Error message:', error.message || 'N/A');
    console.error('========================================');
    console.error('\nFull error object:');
    console.error(JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    process.exit(1);
  }
}

verifySmtp();
