-- branch_employees, branch_employee_availability, and store_bookings need
-- an employee to be able to read/manage rows tied to their own profile_id.
-- branch_employees currently has RLS enabled with zero policies (owner
-- writes go through a service-role API route), which also means an
-- employee's own authenticated session can't read even their own row.
-- These policies are narrowly scoped self-access only.

CREATE POLICY "branch_employees: self read" ON branch_employees
  FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "branch_employee_availability: self select" ON branch_employee_availability
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = branch_employee_availability.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  );

CREATE POLICY "branch_employee_availability: self insert" ON branch_employee_availability
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = branch_employee_availability.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  );

CREATE POLICY "branch_employee_availability: self update" ON branch_employee_availability
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = branch_employee_availability.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = branch_employee_availability.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  );

CREATE POLICY "branch_employee_availability: self delete" ON branch_employee_availability
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = branch_employee_availability.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  );

CREATE POLICY "store_bookings: employee sees assigned bookings" ON store_bookings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM branch_employees be
      WHERE be.id = store_bookings.branch_employee_id
        AND be.profile_id = auth.uid()
        AND be.invite_status = 'active'
    )
  );
