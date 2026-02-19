import nodemailer from 'nodemailer';
import pool from '../db';
import { decrypt } from '../utils/crypto';

let transporter: nodemailer.Transporter | null = null;

/**
 * Load SMTP config from app_settings and create a nodemailer transporter.
 * Returns true if transporter was created successfully.
 */
export async function initTransporter(): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN (
        'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password',
        'smtp_from_address', 'smtp_tls'
      )`
    );

    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    if (!settings.smtp_host || !settings.smtp_port) {
      console.log('SMTP not configured: missing host or port');
      transporter = null;
      return false;
    }

    // smtp_tls is stored as a string in app_settings; coerce correctly.
    // Port 465 = implicit SSL (secure: true). Any other port with TLS = STARTTLS
    // (secure: false + requireTLS: true). No TLS = plain.
    const port = Number(settings.smtp_port);
    const tlsEnabled = settings.smtp_tls == null
      ? true
      : String(settings.smtp_tls) === 'true';
    const implicitSsl = port === 465;

    const transportConfig: any = {
      host: settings.smtp_host,
      port,
      secure: implicitSsl && tlsEnabled,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    };

    if (tlsEnabled && !implicitSsl) {
      // STARTTLS — upgrade the connection after greeting
      transportConfig.requireTLS = true;
    }

    if (settings.smtp_username) {
      let password = settings.smtp_password || '';
      try {
        password = decrypt(password);
      } catch (e) {
        console.error('Failed to decrypt SMTP password:', e);
        transporter = null;
        return false;
      }

      transportConfig.auth = {
        user: settings.smtp_username,
        pass: password,
      };
    }

    transporter = nodemailer.createTransport(transportConfig);
    console.log('SMTP transporter initialized');
    return true;
  } catch (error) {
    console.error('Failed to init SMTP transporter:', error);
    transporter = null;
    return false;
  }
}

/**
 * Re-initialize the transporter (called when admin updates SMTP settings).
 */
export async function refreshTransporter(): Promise<boolean> {
  return initTransporter();
}

/**
 * Queue an email for delivery. If SMTP is not configured, returns immediately.
 */
export async function queueEmail(
  toEmail: string,
  subject: string,
  bodyHtml: string,
  notificationId?: string
): Promise<void> {
  if (!transporter) {
    return;
  }

  await pool.query(
    `INSERT INTO email_queue (to_email, subject, body_html, notification_id)
     VALUES ($1, $2, $3, $4)`,
    [toEmail, subject, bodyHtml, notificationId || null]
  );
}

/**
 * Send a test email immediately (not queued). Returns success/error status.
 */
export async function sendTestEmail(
  toEmail: string
): Promise<{ success: boolean; error?: string }> {
  if (!transporter) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const fromResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'smtp_from_address'`
    );
    const fromAddress = fromResult.rows[0]?.value || 'noreply@localhost';

    await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: 'Cork — Test Email',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a2e; margin-bottom: 16px;">SMTP Configuration Working</h2>
          <p style="color: #555; line-height: 1.5;">
            This test email confirms that your Cork SMTP settings are configured correctly.
            Email notifications are now active.
          </p>
        </div>
      `,
    });

    return { success: true };
  } catch (error: any) {
    console.error('Test email failed:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Process pending emails from the queue.
 * Fetches up to 10 pending emails ready for delivery and attempts to send each.
 */
export async function processEmailQueue(): Promise<void> {
  if (!transporter) {
    return;
  }

  let fromAddress: string;
  try {
    const fromResult = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'smtp_from_address'`
    );
    fromAddress = fromResult.rows[0]?.value || 'noreply@localhost';
  } catch (error) {
    console.error('Failed to load from address:', error);
    return;
  }

  let emails;
  try {
    const result = await pool.query(
      `SELECT id, to_email, subject, body_html, attempts
       FROM email_queue
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 10`
    );
    emails = result.rows;
  } catch (error) {
    console.error('Failed to fetch email queue:', error);
    return;
  }

  for (const email of emails) {
    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email.to_email,
        subject: email.subject,
        html: email.body_html,
      });

      await pool.query(
        `UPDATE email_queue SET status = 'sent' WHERE id = $1`,
        [email.id]
      );
    } catch (error: any) {
      const attempts = email.attempts + 1;
      const errorMessage = error.message || 'Unknown error';

      if (attempts >= 3) {
        await pool.query(
          `UPDATE email_queue SET status = 'failed', attempts = $2, error = $3 WHERE id = $1`,
          [email.id, attempts, errorMessage]
        );
      } else {
        const backoffMinutes = [1, 5, 30][attempts - 1];
        await pool.query(
          `UPDATE email_queue
           SET attempts = $2, error = $3, next_attempt_at = NOW() + INTERVAL '1 minute' * $4
           WHERE id = $1`,
          [email.id, attempts, errorMessage, backoffMinutes]
        );
      }
    }
  }
}

/**
 * Returns true if SMTP is configured (transporter exists).
 */
export function isSmtpConfigured(): boolean {
  return transporter !== null;
}
