create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anyone may join the waitlist; nobody can read it from the browser.
create policy "anyone can sign up" on public.waitlist
  for insert to anon with check (true);
