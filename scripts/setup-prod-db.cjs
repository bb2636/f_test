const { execSync } = require('child_process');

console.log('=== Production Database Schema Setup ===');

const prodDbUrl = process.env.PROD_DATABASE_URL;

if (!prodDbUrl) {
  console.error('ERROR: PROD_DATABASE_URL is not set');
  process.exit(1);
}

console.log('Pushing schema to production database...');

try {
  execSync(`DATABASE_URL="${prodDbUrl}" npx drizzle-kit push --force`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: prodDbUrl }
  });
  console.log('✅ Production database schema created successfully!');
} catch (error) {
  console.error('❌ Failed to push schema to production database:', error.message);
  process.exit(1);
}
