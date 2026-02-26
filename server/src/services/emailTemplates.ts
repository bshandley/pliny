// Email templates for notification emails

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

export interface TemplateContext {
  actorUsername: string;
  cardTitle: string;
  boardName: string;
  boardSlug?: string;
  commentText?: string;
  dueDate?: string;
}

interface EmailOutput {
  subject: string;
  html: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseTemplate(content: string, preferencesLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Plank Notification</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f5f7; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          <!-- Header -->
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <span style="font-size: 14px; font-weight: 700; letter-spacing: 3px; color: #6b7280; text-transform: uppercase;">PLINY</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #ffffff; border: 1px solid #e2e4e9; border-radius: 8px; padding: 32px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 0 0 0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                You received this because of your notification settings.<br>
                <a href="${preferencesLink}" style="color: #9ca3af; text-decoration: underline;">Manage preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function viewCardButton(boardSlug?: string): string {
  if (!boardSlug) return '';
  const url = `${APP_BASE_URL}/${boardSlug}`;
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0 0 0;">
                <tr>
                  <td style="background-color: #4f46e5; border-radius: 6px;">
                    <a href="${url}" style="display: inline-block; padding: 10px 24px; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600;">View Card</a>
                  </td>
                </tr>
              </table>`;
}

function commentBlockquote(commentText?: string): string {
  if (!commentText) return '';
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 16px 0 0 0;">
                <tr>
                  <td style="background-color: #f9fafb; border-left: 3px solid #d1d5db; padding: 12px 16px;">
                    <p style="margin: 0; font-size: 14px; color: #1f2937; line-height: 1.5;">${escapeHtml(commentText)}</p>
                  </td>
                </tr>
              </table>`;
}

function cardInfo(cardTitle: string, boardName: string): string {
  return `
              <p style="margin: 16px 0 0 0; font-size: 14px; color: #1f2937; line-height: 1.5;">
                <strong>Card:</strong> ${escapeHtml(cardTitle)}<br>
                <strong>Board:</strong> ${escapeHtml(boardName)}
              </p>`;
}

// 1. Assigned to card
export function assignedCardEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] You were added to "${ctx.cardTitle}"`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>${escapeHtml(ctx.actorUsername)}</strong> assigned you to a card.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 2. Mentioned in comment
export function mentionCommentEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] @${ctx.actorUsername} mentioned you on "${ctx.cardTitle}"`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>@${escapeHtml(ctx.actorUsername)}</strong> mentioned you in a comment.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${commentBlockquote(ctx.commentText)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 3. Due date reminder
export function dueDateReminderEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] "${ctx.cardTitle}" is due tomorrow`;

  const dueDateDisplay = ctx.dueDate || 'tomorrow';
  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                A card assigned to you is due <strong>${escapeHtml(dueDateDisplay)}</strong>.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 4. Card completed
export function cardCompletedEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] "${ctx.cardTitle}" was marked complete`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>${escapeHtml(ctx.actorUsername)}</strong> marked a card as complete.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 5. Comment added
export function commentAddedEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] @${ctx.actorUsername} commented on "${ctx.cardTitle}"`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>@${escapeHtml(ctx.actorUsername)}</strong> left a comment.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${commentBlockquote(ctx.commentText)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 6. Checklist item assigned
export function checklistAssignedEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] A subtask was assigned to you on "${ctx.cardTitle}"`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>${escapeHtml(ctx.actorUsername)}</strong> assigned a subtask to you.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}

// 7. Description changed
export function descriptionChangedEmail(ctx: TemplateContext): EmailOutput {
  const preferencesUrl = `${APP_BASE_URL}/profile`;
  const subject = `[${ctx.boardName}] "${ctx.cardTitle}" description was updated`;

  const content = `
              <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                <strong>${escapeHtml(ctx.actorUsername)}</strong> updated the card description.
              </p>
              ${cardInfo(ctx.cardTitle, ctx.boardName)}
              ${viewCardButton(ctx.boardSlug)}`;

  return { subject, html: baseTemplate(content, preferencesUrl) };
}
