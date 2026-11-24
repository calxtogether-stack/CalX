# Local Setup Guide

## Prerequisites

- Node.js 20+ (tested on Node 24)
- pnpm (`corepack enable` or `corepack pnpm`)
- Free Supabase project (https://supabase.com)

## Steps

1. **Install dependencies**:
   ```bash
   corepack pnpm install
   ```
2. **Configure Supabase**:
   - Create a free Supabase project.
   - Run `supabase/migrations/0001_initial_schema.sql`, `0002_rls_policies.sql`, and `0003_storage_and_triggers.sql` in the Supabase SQL Editor (or via `supabase db push`).
3. **Configure Environment Variables**:
   - Copy `.env.example` to `apps/web/.env.local` and `apps/mobile/.env`.
   - Fill in `NEXT_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_URL` and the corresponding `ANON_KEY`.
   - Never expose `SUPABASE_SERVICE_ROLE_KEY` in client apps.
4. **Run Web App**:
   ```bash
   corepack pnpm dev:web
   ```
5. **Run Mobile App**:
   ```bash
   corepack pnpm dev:mobile
   ```
