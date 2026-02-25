# Cork GitHub Integration Spec

## Overview
Enable bidirectional linking between Cork cards and GitHub PRs. When a developer references a card in a PR (e.g., "Fixes cork#123"), Cork automatically links them and shows PR status on the card.

---

## User Stories

1. **As a dev**, I want to see my PR status on the card so I know if code is ready
2. **As a PM**, I want cards to auto-move to "In Review" when a PR is opened
3. **As a team**, we want to know which cards have active PRs without leaving Cork

---

## Architecture

```
GitHub Webhook → Cork Server → Database → Socket.io → All Clients
```

---

## Phase 1: PR Linking (MVP)

### 1. Database Schema

```sql
-- Migration: 012_add_github_pr_links.sql

-- Stores PR ↔ Card associations
CREATE TABLE card_pull_requests (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_title TEXT NOT NULL,
  pr_url TEXT NOT NULL,
  pr_state VARCHAR(20) NOT NULL CHECK (pr_state IN ('open', 'closed', 'merged')),
  branch_name VARCHAR(255),
  author_login VARCHAR(255) NOT NULL,
  author_avatar_url TEXT,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  head_sha VARCHAR(40),
  draft BOOLEAN DEFAULT FALSE,
  checks_status VARCHAR(20) CHECK (checks_status IN ('pending', 'success', 'failure', 'neutral')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, repo_owner, repo_name, pr_number)
);

-- Index for quick lookups
CREATE INDEX idx_card_prs_card_id ON card_pull_requests(card_id);
CREATE INDEX idx_card_prs_pr_state ON card_pull_requests(pr_state);

-- Card activity log entry type for PR events
ALTER TYPE activity_type ADD VALUE 'pr_linked';
ALTER TYPE activity_type ADD VALUE 'pr_updated';
ALTER TYPE activity_type ADD VALUE 'pr_merged';
```

### 2. Webhook Endpoint

```typescript
// server/src/routes/github.ts

import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

// POST /api/github/webhook
// Receives events from GitHub
router.post('/webhook', async (req, res) => {
  // 1. Verify webhook signature
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!verifySignature(req.body, signature, secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const event = req.headers['x-github-event'];
  const payload = req.body;
  
  switch (event) {
    case 'pull_request':
      await handlePullRequestEvent(payload);
      break;
    case 'pull_request_review':
      await handlePRReviewEvent(payload);
      break;
    case 'check_suite':
    case 'check_run':
      await handleCheckEvent(payload);
      break;
    default:
      // Ignore other events
  }
  
  res.status(200).send('OK');
});

async function handlePullRequestEvent(payload: any) {
  const { action, pull_request, repository } = payload;
  
  // Parse PR body for cork references: "Fixes cork#123" or "Closes #123" in card context
  const cardIds = extractCardReferences(pull_request.body);
  
  for (const cardId of cardIds) {
    if (action === 'opened') {
      await linkPRToCard(cardId, pull_request, repository);
      await createActivityLog(cardId, 'pr_linked', {
        prNumber: pull_request.number,
        prTitle: pull_request.title,
        author: pull_request.user.login
      });
      
      // Optional: Auto-move card to "In Review" column if configured
      await maybeAutoMoveCard(cardId, 'opened');
    } 
    else if (action === 'closed') {
      const state = pull_request.merged ? 'merged' : 'closed';
      await updatePRState(cardId, pull_request.number, state);
      await createActivityLog(cardId, state === 'merged' ? 'pr_merged' : 'pr_updated', {
        prNumber: pull_request.number,
        merged: state === 'merged'
      });
      
      await maybeAutoMoveCard(cardId, state);
    }
    else if (action === 'edited' || action === 'synchronize') {
      await updatePRInfo(cardId, pull_request);
    }
  }
  
  // Notify all clients watching these cards
  broadcastPRCardUpdate(cardIds);
}

function extractCardReferences(body: string): number[] {
  const refs: number[] = [];
  // Match: "cork#123", "fixes cork#123", "closes #123" (in cork repos)
  const regex = /(?:cork|fixes|closes?|refs?|references?)\s*#(\d+)/gi;
  let match;
  while ((match = regex.exec(body)) !== null) {
    refs.push(parseInt(match[1], 10));
  }
  return [...new Set(refs)]; // Deduplicate
}
```

### 3. API Routes

```typescript
// GET /api/cards/:id/pull-requests
// Returns linked PRs for a card
router.get('/api/cards/:id/pull-requests', async (req, res) => {
  const cardId = parseInt(req.params.id);
  const prs = await db.query(
    `SELECT * FROM card_pull_requests 
     WHERE card_id = $1 
     ORDER BY created_at DESC`,
    [cardId]
  );
  res.json(prs);
});

// GET /api/boards/:id/cards-with-prs
// For dashboard view - shows which cards have PRs
router.get('/api/boards/:id/cards-with-prs', async (req, res) => {
  const boardId = parseInt(req.params.id);
  const result = await db.query(
    `SELECT c.id, c.title, c.column_id,
            json_agg(json_build_object(
              'number', pr.pr_number,
              'title', pr.pr_title,
              'state', pr.pr_state,
              'checksStatus', pr.checks_status
            )) as pull_requests
     FROM cards c
     LEFT JOIN card_pull_requests pr ON pr.card_id = c.id
     WHERE c.board_id = $1 AND pr.id IS NOT NULL
     GROUP BY c.id`,
    [boardId]
  );
  res.json(result);
});
```

### 4. UI Components

```typescript
// client/src/components/PullRequestBadge.tsx

interface PullRequestBadgeProps {
  pr: {
    number: number;
    title: string;
    state: 'open' | 'closed' | 'merged';
    checksStatus?: string;
    draft: boolean;
  };
}

export function PullRequestBadge({ pr }: PullRequestBadgeProps) {
  const getStatusColor = () => {
    if (pr.state === 'merged') return '#8250df'; // Purple
    if (pr.state === 'closed') return '#cf222e'; // Red
    if (pr.checksStatus === 'failure') return '#cf222e';
    if (pr.checksStatus === 'success') return '#1a7f37';
    if (pr.draft) return '#6e7781';
    return '#1a7f37'; // Open
  };
  
  const getIcon = () => {
    if (pr.state === 'merged') return 'git-merge';
    if (pr.state === 'closed') return 'git-pull-request-closed';
    return 'git-pull-request';
  };

  return (
    <a 
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.prBadge}
      style={{ borderLeftColor: getStatusColor() }}
    >
      <Icon name={getIcon()} size={14} />
      <span className={styles.prNumber}>#{pr.number}</span>
      <span className={styles.prTitle} title={pr.title}>
        {truncate(pr.title, 40)}
      </span>
      {pr.checksStatus && (
        <ChecksIcon status={pr.checksStatus} size={14} />
      )}
    </a>
  );
}
```

```typescript
// client/src/components/KanbanCard.tsx (enhanced)

// Add to card display:
{card.pullRequests?.length > 0 && (
  <div className={styles.prSection}>
    {card.pullRequests.map(pr => (
      <PullRequestBadge key={pr.number} pr={pr} />
    ))}
  </div>
)}
```

```typescript
// client/src/components/CardModal.tsx (PR tab)

// Add "Pull Requests" tab in card modal
<Tab label="Pull Requests" badge={prs.length}>
  <div className={styles.prList}>
    {pullRequests.length === 0 ? (
      <EmptyState 
        title="No linked PRs"
        description="Reference this card in a PR with 'cork#123'"
      />
    ) : (
      pullRequests.map(pr => <PullRequestDetail key={pr.id} pr={pr} />)
    )}
    
    {/* Manual link (for edge cases) */}
    <Button variant="secondary" onClick={() => setShowManualLink(true)}>
      Link existing PR
    </Button>
  </div>
</Tab>
```

### 5. Real-time Updates (Socket.io)

```typescript
// server/src/websockets/github.ts

export function broadcastPRCardUpdate(cardIds: number[]) {
  cardIds.forEach(cardId => {
    io.to(`card:${cardId}`).emit('card:pr_update', { cardId });
  });
}

// Client side (client/src/hooks/useCardPullRequests.ts)
export function useCardPullRequests(cardId: number) {
  const [prs, setPrs] = useState([]);
  
  useEffect(() => {
    // Initial fetch
    fetchPRs(cardId).then(setPrs);
    
    // Subscribe to real-time updates
    socket.emit('subscribe:card', cardId);
    socket.on('card:pr_update', ({ cardId: updatedId }) => {
      if (updatedId === cardId) {
        fetchPRs(cardId).then(setPrs);
      }
    });
    
    return () => {
      socket.emit('unsubscribe:card', cardId);
      socket.off('card:pr_update');
    };
  }, [cardId]);
  
  return prs;
}
```

---

## Phase 2: Automation (Future)

```typescript
// server/src/automation/rules/githubRules.ts

// When PR opened → move card to "In Review"
// When PR merged → move card to "Done"
// When PR closed (not merged) → add "Needs Work" label

interface AutomationRule {
  id: string;
  boardId: number;
  trigger: 'pr_opened' | 'pr_merged' | 'pr_closed';
  targetColumnId?: number;
  addLabelIds?: number[];
}

// Simple rule engine
async function evaluateAutomationRules(event: string, cardId: number) {
  const rules = await db.query(
    'SELECT * FROM automation_rules WHERE trigger = $1 AND board_id = (SELECT board_id FROM cards WHERE id = $2)',
    [event, cardId]
  );
  
  for (const rule of rules) {
    if (rule.target_column_id) {
      await moveCardToColumn(cardId, rule.target_column_id);
    }
    // ... other actions
  }
}
```

---

## Security

1. **Webhook Secret**: Required env var `GITHUB_WEBHOOK_SECRET`
2. **Signature Verification**: HMAC-SHA256 validation
3. **Scope**: Webhooks only write PR data, never expose sensitive data
4. **Admin Only**: GitHub integration settings restricted to board admins

---

## Setup Instructions (for Users)

1. Go to Board Settings → Integrations → GitHub
2. Enter webhook URL: `https://cork.handley.io/api/github/webhook`
3. Copy webhook secret to GitHub repo settings
4. Subscribe to events: Pull requests, Reviews, Checks

---

## Migration Plan

1. **Database**: Migration 012 (adds card_pull_requests table)
2. **Routes**: Add `server/src/routes/github.ts`
3. **UI**: Add PR components to KanbanCard and CardModal
4. **Config**: Add GITHUB_WEBHOOK_SECRET to environment
5. **Tests**: Webhook signature verification, PR parsing, activity log creation

---

## Success Metrics

- [ ] PR referenced in body appears on card within 5 seconds
- [ ] PR status updates in real-time across all clients
- [ ] No webhook signature failures (security)
- [ ] Cards with PRs are visually distinct (icon/badge)

---

## Open Questions

1. **Multiple repos**: Should Cork support webhooks from multiple GitHub repos per board?
2. **PR templates**: Support structured references like "Card: cork#123"?
3. **Bitbucket/GitLab**: Abstract for polyglot support later?

**Recommendation**: Start with single-repo support, hardcode "cork#123" pattern, defer polyglot support.
