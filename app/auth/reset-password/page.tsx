"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const updatePassword = async () => {
    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Password updated successfully.");
      window.location.href = "/dashboard";
    }
  };

  return (
    <div>
      <h1>Set New Password</h1>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
      />

      <button onClick={updatePassword}>
        Update Password
      </button>

      {message && <p>{message}</p>}
    </div>
  );
}