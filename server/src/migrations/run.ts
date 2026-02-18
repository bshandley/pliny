import fs from 'fs';
import path from 'path';
import pool from '../db';

async function runMigrations() {
  try {
    // Run base schema
    const schema = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf-8'
    );
    await pool.query(schema);

    // Run upgrade migration (idempotent)
    const upgrade = fs.readFileSync(
      path.join(__dirname, '002-user-management.sql'),
      'utf-8'
    );
    await pool.query(upgrade);

    // Add due dates to cards
    const dueDates = fs.readFileSync(
      path.join(__dirname, '003-due-dates.sql'),
      'utf-8'
    );
    await pool.query(dueDates);

    // Add labels, comments, checklists, archive
    const features = fs.readFileSync(
      path.join(__dirname, '004-labels-comments-checklists-archive.sql'),
      'utf-8'
    );
    await pool.query(features);

    // Add board archiving
    const boardArchive = fs.readFileSync(
      path.join(__dirname, '005-board-archive.sql'),
      'utf-8'
    );
    await pool.query(boardArchive);

    // Add activity, card members, notifications
    const activityMembersNotifications = fs.readFileSync(
      path.join(__dirname, '006-activity-members-notifications.sql'),
      'utf-8'
    );
    await pool.query(activityMembersNotifications);

    // Add collaborator role
    const collaboratorRole = fs.readFileSync(
      path.join(__dirname, '007-collaborator-role.sql'),
      'utf-8'
    );
    await pool.query(collaboratorRole);

    // Add SSO and TOTP support
    const ssoTotp = fs.readFileSync(
      path.join(__dirname, '008-sso-totp.sql'),
      'utf-8'
    );
    await pool.query(ssoTotp);

    // Add user profile fields (email, display_name, avatar_url)
    const userProfileFields = fs.readFileSync(
      path.join(__dirname, '009-user-profile-fields.sql'),
      'utf-8'
    );
    await pool.query(userProfileFields);

    // Add OIDC claim mapping fields
    const oidcClaimMapping = fs.readFileSync(
      path.join(__dirname, '010-oidc-claim-mapping.sql'),
      'utf-8'
    );
    await pool.query(oidcClaimMapping);

    // Add configurable callback base URL
    const oidcCallbackUrl = fs.readFileSync(
      path.join(__dirname, '011-oidc-callback-url.sql'),
      'utf-8'
    );
    await pool.query(oidcCallbackUrl);

    // Custom fields
    const customFields = fs.readFileSync(
      path.join(__dirname, '012-custom-fields.sql'),
      'utf-8'
    );
    await pool.query(customFields);

    console.log('Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
