# Pliny Go-to-Market Strategy

_Last updated: 2025-02-28_

## The Core Principle

You're a full-time employee with a side project that's already built. That context changes everything.

The cloud hosting route — while strategically correct long-term — requires real ops work: multi-tenant infrastructure, support tickets, SLA obligations, payment disputes. That's a second job on top of your second job. Wrong move right now.

**Sequence matters more than perfection. Get distribution before monetization.**

---

## The Four Steps (In Order)

### Step 1: Ship Publicly — Solve the Distribution Problem First

You don't have a monetization problem yet. You have a distribution problem. Nobody knows Pliny exists. Before any pricing strategy matters, you need users.

- [ ] Get it on **GitHub publicly**
- [ ] Post on **Hacker News** (Show HN: I built a self-hosted Trello alternative)
- [ ] Post on **Product Hunt**
- [ ] Write one honest "I built a self-hosted Trello alternative" post and put it on Reddit:
  - `r/selfhosted` (500k+ members, exactly your audience)
  - `r/devops`
  - `r/selfhosted` alone could drive meaningful early traction

This costs you a Saturday afternoon.

### Step 2: Lowest-Friction Monetization (No Ops Required)

While people are discovering it, add one thing: **a commercial license**.

- Free for personal and non-commercial use
- **$200–400/year per organization** for commercial use
- Use **[Polar.sh](https://polar.sh)** or **Gumroad** — they handle payment page, tax compliance (VAT/GST), receipts. You don't touch any of it.
- Price per **org, not per seat** — enterprises can rationalize a flat fee; per-seat pricing requires procurement to count heads

> This is 30 minutes to set up, zero ongoing ops, and captures revenue without building anything.

### Step 3: "Powered by Pliny" on Public Board Links

You already built public read-only board links. Add a small footer:

> _"Made with Pliny — self-hosted kanban"_

Every stakeholder who gets a board link is a potential lead. Passive distribution at zero cost. Every public board is an ad.

- Opt-out available for paid commercial license holders
- Mirrors the SignWell model: free tier exposes the brand to non-users at scale

### Step 4: Cloud Hosting as a Waitlist, Not a Product

Don't build it until demand justifies it.

- Add a **"Pliny Cloud — coming soon"** page with email signup
- If **500+ people** sign up → build it
- If **20 people** sign up → you just saved yourself 3 months of ops work

Let demand tell you whether it's worth it. You have enterprise sales instincts from Wiz — use them. But they only matter once there's someone to sell to.

---

## Priority Order (Ruthlessly Honest)

1. **Ship publicly** — you've been building in private too long
2. **Commercial license** — 30 minutes, zero ops, immediate revenue potential
3. **Watch how people actually use it** — let real usage inform decisions
4. **Decide on cloud hosting** — based on real waitlist demand, not assumptions

---

## The SignWell Parallel

Ruben Gamez built Bidsketch → SignWell bootstrapped to several million ARR. Key insight: **the free tier is a distribution mechanism, not a charity.** Every signed document recipient sees the SignWell brand. Every Pliny public board viewer is a potential customer.

Free self-hosted = trust builder + brand exposure  
Commercial license = frictionless revenue  
Cloud hosted = only when demand is proven

---

## What We're NOT Doing (Yet)

- Multi-tenant cloud infrastructure (ops overhead not worth it yet)
- Per-seat pricing (adds procurement friction)
- VC funding (you're building this to own it)
- Complex tier structures (one license = one decision for buyers)
