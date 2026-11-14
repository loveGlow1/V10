-- Every credit that arrives or lapses is now a line in the person's credit
-- history, not only what they buy and spend: an annual plan's monthly
-- allowance, unused plan credits that expire, credits rolled over, and the
-- plan ending. Each is written once (dedupe_key per day), marked
-- source = 'plan' so the history can tell them from purchases.
create or replace function public.ensure_credit_balance(p_user_id uuid)
returns public.credit_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance public.credit_balances;
  v_plan    public.credit_plans;
  v_today   date := (now() at time zone 'utc')::date;
  v_old_daily    numeric;
  v_old_monthly  numeric;
  v_old_rollover numeric;
  v_old_plan     text;
  v_cycle        date;
begin
  -- The lock is what makes two concurrent charges safe: the second waits here
  -- rather than reading a balance the first is about to change.
  select * into v_balance from public.credit_balances
    where user_id = p_user_id
    for update;

  if not found then
    select * into v_plan from public.credit_plans where id = 'free';
    insert into public.credit_balances (user_id, plan_id, daily, monthly)
      values (p_user_id, 'free', v_plan.daily_credits, v_plan.monthly_credits)
      returning * into v_balance;
    return v_balance;
  end if;

  select * into v_plan from public.credit_plans where id = v_balance.plan_id;
  v_old_daily    := v_balance.daily;
  v_old_monthly  := v_balance.monthly;
  v_old_rollover := v_balance.rollover;
  v_old_plan     := v_plan.name;
  v_cycle        := v_balance.cycle_started_on;

  -- A new day: refill the daily grant and drop yesterday's remainder.
  if v_balance.daily_refreshed_on < v_today then
    v_balance.daily := v_plan.daily_credits;
    v_balance.daily_refreshed_on := v_today;
    -- Every credit that arrives or lapses is a line in the history, so the
    -- person can follow their balance month by month (source 'plan').
    if v_old_daily > 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', -v_old_daily, 'Unused daily credits expired', 'plan', format('daily-expire:%s', v_today))
        on conflict do nothing;
    end if;
    if v_plan.daily_credits > 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', v_plan.daily_credits, format('Daily credits (%s plan)', v_plan.name), 'plan', format('daily:%s', v_today))
        on conflict do nothing;
    end if;
  end if;

  -- A new cycle: this cycle's unused grant becomes the rollover on a plan that
  -- allows one, the previous rollover expires, and top-ups survive untouched.
  if v_balance.cycle_started_on + interval '1 month' <= v_today then
    v_balance.rollover := case when v_plan.rollover_cycles > 0 then v_balance.monthly else 0 end;

    if v_old_rollover > 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', -v_old_rollover, 'Rolled-over credits expired', 'plan', format('rollover-expire:%s', v_today))
        on conflict do nothing;
    end if;
    if v_old_monthly > 0 and v_plan.rollover_cycles = 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', -v_old_monthly, format('Unused %s plan credits expired', v_old_plan), 'plan', format('monthly-expire:%s', v_today))
        on conflict do nothing;
    end if;
    -- Carried over, not new: recorded at zero so the statement says where they went.
    if v_balance.rollover > 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', 0, format('%s unused plan credits rolled over to this month', v_balance.rollover), 'plan', format('rollover:%s', v_today))
        on conflict do nothing;
    end if;

    -- The month that was paid for is over and no new one was bought: back to
    -- Free. What was left of the paid grant still rolls over where the plan
    -- allowed it (above) — it was paid for — and top-ups are never touched.
    if v_balance.plan_id <> 'free'
       and (v_balance.paid_through is null or v_balance.paid_through <= v_today) then
      select * into v_plan from public.credit_plans where id = 'free';
      v_balance.plan_id := 'free';
      v_balance.paid_through := null;
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', 0, format('%s plan ended - now on Free', v_old_plan), 'plan', format('plan-ended:%s', v_today))
        on conflict do nothing;
    end if;

    v_balance.monthly := v_plan.monthly_credits;
    v_balance.cycle_started_on := v_today;
    -- A month of a plan already paid for (an annual plan's later months).
    if v_plan.monthly_credits > 0 then
      insert into public.credit_ledger (user_id, action, credits, description, source, dedupe_key)
        values (p_user_id, 'grant', v_plan.monthly_credits, format('Monthly %s plan credits', v_plan.name), 'plan', format('monthly:%s', v_today))
        on conflict do nothing;
    end if;
  end if;

  update public.credit_balances set
    plan_id = v_balance.plan_id,
    paid_through = v_balance.paid_through,
    daily = v_balance.daily,
    monthly = v_balance.monthly,
    rollover = v_balance.rollover,
    daily_refreshed_on = v_balance.daily_refreshed_on,
    cycle_started_on = v_balance.cycle_started_on
  where user_id = p_user_id
  returning * into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.ensure_credit_balance(uuid) from public, anon, authenticated;
