-- 20260830_role_based_dashboards.sql
-- Separates dashboards by user type: Customer, Employee, Artist, Store Owner (business_partner), Super Admin.
-- Schema only — RLS/API-layer authorization and dashboard routing are a follow-up pass.

-- 1. Allow 'employee' as an account_type + matching boolean flag
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_account_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_type_check
  CHECK (account_type = ANY (ARRAY['customer'::text, 'artist'::text, 'business_partner'::text, 'employee'::text]));

ALTER TABLE public.profiles ADD COLUMN is_employee boolean NOT NULL DEFAULT false;

-- 2. Customer "sell products" opt-in — additive flag, does NOT change account_type.
ALTER TABLE public.profiles ADD COLUMN is_seller boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN seller_enabled_at timestamptz;

-- 3. Turn branch_employees into a real per-branch staff assignment.
ALTER TABLE public.branch_employees ADD COLUMN profile_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.branch_employees ADD COLUMN rank text NOT NULL DEFAULT 'staff'
  CHECK (rank = ANY (ARRAY['staff'::text, 'manager'::text]));
ALTER TABLE public.branch_employees ADD COLUMN can_manage_products boolean NOT NULL DEFAULT false;
ALTER TABLE public.branch_employees ADD COLUMN can_manage_calendar boolean NOT NULL DEFAULT false;
ALTER TABLE public.branch_employees ADD COLUMN can_view_analytics boolean NOT NULL DEFAULT false;
ALTER TABLE public.branch_employees ADD COLUMN can_view_revenue boolean NOT NULL DEFAULT false;
ALTER TABLE public.branch_employees ADD COLUMN invited_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.branch_employees ADD COLUMN invite_status text NOT NULL DEFAULT 'active'
  CHECK (invite_status = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text]));

ALTER TABLE public.branch_employees
  ADD CONSTRAINT branch_employees_branch_profile_unique UNIQUE (branch_id, profile_id);

-- 4. Hard cap: at most 2 managers per branch (DB-enforced, not just a UI check)
CREATE OR REPLACE FUNCTION public.enforce_branch_manager_cap()
RETURNS trigger AS $$
BEGIN
  IF NEW.rank = 'manager' THEN
    IF (
      SELECT count(*) FROM public.branch_employees
      WHERE branch_id = NEW.branch_id
        AND rank = 'manager'
        AND id <> NEW.id
    ) >= 2 THEN
      RAISE EXCEPTION 'A branch can have at most 2 managers';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_branch_manager_cap
BEFORE INSERT OR UPDATE OF rank, branch_id ON public.branch_employees
FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_manager_cap();

-- 5. Employee's own working availability
CREATE TABLE public.branch_employee_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_employee_id uuid NOT NULL REFERENCES public.branch_employees(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_employee_availability ENABLE ROW LEVEL SECURITY;

-- 6. Extend feature_subscriptions to cover artist analytics
ALTER TABLE public.feature_subscriptions
  DROP CONSTRAINT feature_subscriptions_feature_check;
ALTER TABLE public.feature_subscriptions
  ADD CONSTRAINT feature_subscriptions_feature_check
  CHECK (feature = ANY (ARRAY['review_insights'::text, 'artist_analytics'::text]));
