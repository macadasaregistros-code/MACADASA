import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

let cachedClient: SupabaseClient | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Configure it in .env or in the server runtime.`
    );
  }

  return value;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedClient;
}
